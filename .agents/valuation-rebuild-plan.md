# Valuation Rebuild — Implementation Plan

> Drafted 2026-05-12. Locked decisions in source prompt. This doc is the
> reference for execution; deviations from it require updating §9 first.

---

## 1. Overview

The current valuation pipeline caches a `cardhedger_id` per card on first
ingestion and never re-resolves it against the cert. A scan of every
PSA-grader card in the DB found 3 of 19 (~16%) where the cached id no longer
matches what `prices-by-cert` would resolve today. For at least 2 of these
(Mahomes Blue Wave, Rodriguez Titanium), the cached id points at the **base**
card; the actual cert is a **parallel**. Sales history in the sidebar shows
the wrong card's comps; estimated_value is anchored to the wrong card's
sales.

The rebuild:

1. **Re-anchors valuation on the cert, not the cache.** Every refresh starts
   with `prices-by-cert` and treats CardHedger's returned `card_id` as
   authoritative. If the cached id differs, we update it and invalidate the
   sales cache.
2. **Promotes parallels to first-class data.** A new `variant` column captures
   "Blue Wave", "Titanium", "Refractor", etc. — currently lost in the gap
   between PSA's free-form `description` and our normalized `brand` column.
3. **Adds price-estimate alongside comps.** A new `estimate_price` column
   (with range, confidence, method, freshness fields) sits next to the
   existing `estimated_value` (comps-derived). The UI surfaces estimate_price
   as the headline value with a confidence chip; comps continue to feed the
   sales-history table.
4. **Backfills via manual approval.** Every existing card is run through the
   new flow once. A backfill script prints the proposed change per card and
   prompts y/n before applying — no silent overwrite of cards we'd
   misidentify.

---

## 2. Schema changes

One additive migration. Backwards-compatible: existing reads of
`estimated_value` continue working; new columns are nullable until
populated.

`backend/db/migrations/0002_valuation_rebuild.sql`:

```sql
-- 0002_valuation_rebuild.sql
-- Adds price-estimate fields and variant column to cards.
-- Idempotent (IF NOT EXISTS on every column).
-- Runs alongside the existing estimated_value column during transition;
-- estimate_price is the new headline value source per MASTER §1.5.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS estimate_price          numeric(10,2),
  ADD COLUMN IF NOT EXISTS estimate_price_low      numeric(10,2),
  ADD COLUMN IF NOT EXISTS estimate_price_high     numeric(10,2),
  ADD COLUMN IF NOT EXISTS estimate_confidence     numeric(5,4),
  ADD COLUMN IF NOT EXISTS estimate_method         varchar(40),
  ADD COLUMN IF NOT EXISTS estimate_freshness_days integer,
  ADD COLUMN IF NOT EXISTS estimate_last_updated   timestamptz,
  ADD COLUMN IF NOT EXISTS variant                 varchar(100);

-- Index on cardhedger_id so the backfill's mismatch lookup runs fast.
-- Existing column; this is a new index on it.
CREATE INDEX IF NOT EXISTS idx_cards_cardhedger_id ON cards (cardhedger_id);
```

**Why these column types:**

| Column | Type | Rationale |
|---|---|---|
| `estimate_price` | `numeric(10,2)` | Same shape as `estimated_value` — currency to two decimals, max ~$99M (well over any single card). |
| `estimate_price_low` | `numeric(10,2)` | Same. |
| `estimate_price_high` | `numeric(10,2)` | Same. |
| `estimate_confidence` | `numeric(5,4)` | CardHedger returns 0.0000–1.0000 (e.g. 0.4017, 0.6660). 4 decimals = no rounding. |
| `estimate_method` | `varchar(40)` | Observed values: `direct`, `card_interpolation`. CardHedger may add more (`correlated`, etc.); 40 chars is safe headroom. |
| `estimate_freshness_days` | `integer` | Days since the most recent comp the estimate is anchored on. |
| `estimate_last_updated` | `timestamptz` | When *we* refreshed the estimate. Distinct from `value_last_updated` (which tracks the comps refresh) so they can drift if one fails. |
| `variant` | `varchar(100)` | "Blue Wave", "Refractor", "Titanium", "Desert Shield", etc. CardHedger's `card-details.variant` field is single-word-to-short-phrase; 100 is safe. |

**Apply via Query Editor** (per CONTEXT.md §11). Verify with:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'cards'
  AND (column_name LIKE 'estimate%' OR column_name = 'variant')
ORDER BY column_name;
```

Expected: 8 rows (7 estimate_* + variant).

---

## 3. Backend changes (file-by-file)

### `backend/functions/portfolio/pricing.js` — additive

Adds two new exported functions and one orchestrator. The existing
`fetchMarketValue` stays for cards added via fuzzy-match path (no cert).

```js
// New: full structured response from card-details
async function fetchCardDetails(cardId) {
  const res = await chPost("/v1/cards/card-details", { card_id: cardId }, TIMEOUT_FAST_MS);
  return res?.cards?.[0] ?? null;
}

// New: price-estimate at a specific grade
async function fetchPriceEstimate(cardId, gradeLabel) {
  const res = await chPost(
    "/v1/cards/price-estimate",
    { card_id: cardId, grade: gradeLabel },
    TIMEOUT_FAST_MS,
  );
  if (!res || res.price == null) return null;
  return {
    price:          round2(res.price),
    priceLow:       res.price_low  != null ? round2(res.price_low)  : null,
    priceHigh:      res.price_high != null ? round2(res.price_high) : null,
    confidence:     res.confidence ?? null,
    method:         res.method     ?? null,
    freshnessDays:  res.freshness_days ?? null,
  };
}

// New orchestrator: cert -> {cardhedgerId, variant, comps, estimate}
// Used by add-card.js and refresh-portfolio.js (cert path).
// Cards without a cert continue using fetchMarketValue.
async function fetchValuation({ certNumber, grader, grade }) {
  const label = gradeLabel(grade);
  if (!label) return null;

  // 1. cert -> card_id (authoritative)
  const certRes = await chPost(
    "/v1/cards/prices-by-cert",
    { cert: String(certNumber), grader: grader || "PSA", days: 90 },
    TIMEOUT_FAST_MS,
    { allow422: true },
  );
  if (!certRes?.card?.card_id) return null;
  const cardId = certRes.card.card_id;

  // 2-4. Run in parallel — independent calls, all keyed on cardId
  const [details, comps, estimate] = await Promise.all([
    fetchCardDetails(cardId).catch(() => null),
    fetchComps(cardId, label).catch(() => null),
    fetchPriceEstimate(cardId, label).catch(() => null),
  ]);

  return {
    cardhedgerId:       cardId,
    cardhedgerImageUrl: safeImageUrl(certRes.card.image ?? details?.image),
    variant:            details?.variant ?? null,
    comps: comps ? {
      avgSalePrice:  comps.comp_price != null ? round2(parseFloat(comps.comp_price)) : null,
      lastSalePrice: comps.raw_prices?.[0]?.price != null ? round2(parseFloat(comps.raw_prices[0].price)) : null,
      numSales:      comps.count_used ?? (comps.raw_prices?.length ?? 0),
      rawComps:      comps.raw_prices ?? [],
    } : null,
    estimate,  // {price, priceLow, priceHigh, confidence, method, freshnessDays} or null
  };
}

module.exports = {
  fetchMarketValue,    // existing — kept for fuzzy-match path
  fetchComps,          // existing
  fetchAllPrices,      // existing
  gradeLabel,          // existing
  fetchValuation,      // new
  fetchCardDetails,    // new
  fetchPriceEstimate,  // new
};
```

**No breaking changes.** Existing callers of `fetchMarketValue` continue to
work.

### `backend/functions/portfolio/refresh-portfolio.js` — switches to fetchValuation

For cards with a cert, replace the `fetchMarketValue` call with
`fetchValuation` and write the new columns. Fuzzy-match-only cards (no cert,
shouldn't exist for PSA but defensive) fall back to `fetchMarketValue`.

Critical addition: **detect cardhedger_id mismatch and invalidate raw_comps**
when the cert path returns a different id than what's cached:

```js
const valuation = certNumber
  ? await fetchValuation({ certNumber, grader, grade })
  : null;

// If we got a cert-resolved id and it differs from what's cached, the cache
// is for the wrong card. Invalidate raw_comps so the new id's comps land
// next refresh, and update cardhedger_id to the authoritative value.
const idChanged = valuation?.cardhedgerId
  && row.cardhedger_id
  && valuation.cardhedgerId !== row.cardhedger_id;

await db.query(
  `UPDATE cards SET
     -- legacy columns kept in sync during transition
     estimated_value      = COALESCE($1, estimated_value),
     avg_sale_price       = $1,
     last_sale_price      = $2,
     num_sales            = $3,
     price_source         = 'cardhedger',
     -- always refresh the canonical pointer
     cardhedger_id        = $4,
     cardhedger_image_url = COALESCE($5, cardhedger_image_url),
     -- sales cache: replace if id changed, append-merge otherwise (today's
     -- behavior is replace either way; flagging this for the followup)
     raw_comps            = $6,
     value_last_updated   = NOW(),
     -- new estimate columns
     estimate_price          = $7,
     estimate_price_low      = $8,
     estimate_price_high     = $9,
     estimate_confidence     = $10,
     estimate_method         = $11,
     estimate_freshness_days = $12,
     estimate_last_updated   = NOW(),
     variant                 = COALESCE($13, variant)
   WHERE id = $14`,
  [
    valuation?.comps?.avgSalePrice ?? null,
    valuation?.comps?.lastSalePrice ?? null,
    valuation?.comps?.numSales ?? 0,
    valuation?.cardhedgerId ?? row.cardhedger_id,
    valuation?.cardhedgerImageUrl ?? null,
    JSON.stringify(valuation?.comps?.rawComps ?? []),
    valuation?.estimate?.price ?? null,
    valuation?.estimate?.priceLow ?? null,
    valuation?.estimate?.priceHigh ?? null,
    valuation?.estimate?.confidence ?? null,
    valuation?.estimate?.method ?? null,
    valuation?.estimate?.freshnessDays ?? null,
    valuation?.variant ?? null,
    row.id,
  ],
);
```

**Note on `estimated_value`:** kept in sync via `COALESCE($1, estimated_value)`
where `$1` is comps comp_price. This means existing UI that still reads
`estimated_value` won't break during the transition. After all consumers
move to `estimate_price`, we drop the column in a follow-up migration.

### `backend/functions/cards/add-card.js` — runs the new flow on insert

Today, `add-card.js` inserts the card row and lets the next refresh populate
pricing. The new flow runs `fetchValuation` synchronously during add so the
card lands with a correct `cardhedger_id`, `variant`, and full estimate from
the first render.

```js
// After the cert metadata is gathered (PSA lookup already happened upstream),
// before INSERT:
const valuation = await fetchValuation({
  certNumber,
  grader,
  grade,
}).catch((err) => {
  console.warn("[add-card] valuation fetch failed:", err.message);
  return null;
});

// Pass valuation fields into the INSERT statement (or follow-up UPDATE).
// Don't fail the insert if valuation is null — pricing is best-effort,
// the next scheduled refresh will retry.
```

### `backend/functions/cards/get-cards.js` and `get-card.js` — return new fields

Add to the SELECT and the response shape:

```js
SELECT
  // ... existing fields ...
  c.estimate_price,
  c.estimate_price_low,
  c.estimate_price_high,
  c.estimate_confidence,
  c.estimate_method,
  c.estimate_freshness_days,
  c.estimate_last_updated,
  c.variant
FROM cards c ...
```

Response object adds (camelCase per existing convention):

```js
{
  // ... existing fields ...
  estimatePrice:          row.estimate_price ? parseFloat(row.estimate_price) : null,
  estimatePriceLow:       row.estimate_price_low ? parseFloat(row.estimate_price_low) : null,
  estimatePriceHigh:      row.estimate_price_high ? parseFloat(row.estimate_price_high) : null,
  estimateConfidence:     row.estimate_confidence != null ? parseFloat(row.estimate_confidence) : null,
  estimateMethod:         row.estimate_method ?? null,
  estimateFreshnessDays:  row.estimate_freshness_days ?? null,
  estimateLastUpdated:    row.estimate_last_updated ?? null,
  variant:                row.variant ?? null,
}
```

### `backend/functions/portfolio/get-value.js` — dashboard fast-path

Update aggregate computation to prefer `estimate_price` over `estimated_value`
when present:

```js
SELECT
  // ... cards array ...
  SUM(COALESCE(c.estimate_price, c.estimated_value)) FILTER (
    WHERE c.status IS NULL
      AND (cn.status IS NULL OR cn.status NOT IN ('sold'))
  ) AS total_value,
  // ...
```

### `backend/functions/portfolio/get-card-sales.js` — no required change

The sales-history endpoint already serves whatever's in `raw_comps`. Once the
new flow populates raw_comps with the correct card's sales, this endpoint
returns the right data automatically. No code change.

---

## 4. Frontend changes (file-by-file)

### `frontend/src/utils/portfolio.js` — value source switch + confidence helper

Update `effectiveValue` to prefer `estimatePrice`:

```js
export function effectiveValue(card) {
  if (!card) return null;
  if (isSold(card)) return card.sellersNet ?? card.consignmentSoldPrice;
  // NEW: prefer estimate_price (price-estimate) over estimated_value (comps)
  return card.estimatePrice ?? card.estimatedValue ?? null;
}
```

Update `summarizePortfolio` to use the same precedence:

```js
const v = c.estimatePrice ?? c.estimatedValue ?? null;
```

Add a new helper `confidenceLabel`:

```js
// Maps CardHedger price-estimate confidence (0.0-1.0) to a UI tier label.
// Thresholds locked in MASTER §1.5: Low <0.5 / Medium 0.5-0.75 / High >0.75.
export function confidenceLabel(confidence) {
  if (confidence == null) return null;
  if (confidence < 0.5)  return "Low";
  if (confidence < 0.75) return "Medium";
  return "High";
}
```

### `frontend/src/components/CardModal.jsx` — variant + range + confidence

Three additions inside the existing card-detail render:

1. **Card title gains variant suffix.** Where the title currently renders
   `{card.year} {card.brand} {card.playerName}`, append `· {card.variant}`
   when present. Single line — variant inline after the set/brand string.

2. **Headline value shifts source + adds range underneath.**
   Current:
   ```jsx
   <div style={st.estimateBig}>{fmt(displayValue)}</div>
   ```
   New:
   ```jsx
   <div style={st.estimateBig}>{fmt(displayValue)}</div>
   {card.estimatePriceLow != null && card.estimatePriceHigh != null && (
     <div style={st.estimateRange}>
       {fmt(card.estimatePriceLow)} – {fmt(card.estimatePriceHigh)}
     </div>
   )}
   ```

3. **Confidence chip beside or beneath the range.**
   ```jsx
   {card.estimateConfidence != null && (
     <span style={st.confidenceChip[confidenceLabel(card.estimateConfidence).toLowerCase()]}>
       {confidenceLabel(card.estimateConfidence)} confidence
     </span>
   )}
   ```

   Style block additions:
   ```js
   estimateRange: {
     fontSize: "0.78rem",
     color: "#64748b",        // text-subtle slate
     fontVariantNumeric: "tabular-nums",
     marginTop: "0.2rem",
   },
   confidenceChip: {
     low:    { color: "#94a3b8", background: "rgba(148,163,184,0.10)", border: "1px solid rgba(148,163,184,0.30)" },
     medium: { color: "#cbd5e1", background: "rgba(203,213,225,0.10)", border: "1px solid rgba(203,213,225,0.30)" },
     high:   { color: "#34d399", background: "rgba(52,211,153,0.10)",  border: "1px solid rgba(52,211,153,0.30)" },
   },
   ```

   (Each variant of `confidenceChip` shares base padding/font/radius via
   spread; details left to component author.)

**`estimateMethod` and `estimateFreshnessDays` are NOT displayed** per locked
decisions. They're stored on the card payload for analytics + future use.

### Card-title renderers across other pages — light touch

Variant should appear wherever a card title is shown to avoid the same
"wrong card" confusion the modal had. Surfaces:

- `pages/PortfolioPage.jsx` — CardTile (3 contexts: Dashboard performers,
  My Collection grid, Collection History grid)
- `components/TradeTab.jsx` — given/received card chips inside the trade builder
- `components/ConfirmModal.jsx` — `cardTitle` helper (per phase-2 step-1
  refactor)
- `components/TradeHistory.jsx` — historical trade-card chips
- `pages/AdminConsignmentsPage.jsx` — table rows

For v1, scope to **CardModal only**. The other surfaces stay
variant-less initially; add them in a follow-up commit once CardModal proves
the pattern in production. This contains the risk surface to a single
component.

---

## 5. MASTER.md addition — confidence + method documentation

Insert a new subsection in §1, between current §1.4 (Semantic) and §2
(Typography). Section number `1.5`.

```markdown
### 1.5 Valuation confidence + method

Cards now carry a `price-estimate`-derived headline value (`estimate_price`)
alongside the comps-derived `estimated_value`. The estimate ships with two
metadata fields that drive UI behavior.

**Confidence tiers** — the only confidence-derived UI signal. Three tiers
mapped from the raw 0.0–1.0 `estimate_confidence` value:

| Tier | Threshold | Color token | Example use |
|---|---|---|---|
| Low | confidence < 0.5 | `text-muted` (#94a3b8) | Card has limited recent comps; estimate is interpolated |
| Medium | 0.5 ≤ confidence < 0.75 | `text-secondary` (#cbd5e1) | Some recent direct sales; estimate is reasonable |
| High | confidence ≥ 0.75 | `gain` (#34d399) | Multiple recent direct sales; estimate is trusted |

Render the tier as the literal word ("Low" / "Medium" / "High") in a small
slate-toned chip with the color from the table above, **never the raw
0.4017-style number**. The number isn't useful UX; the tier word answers
"how much should I trust this?".

**Method values** — stored on the card payload, **not displayed** in v1.
Three observed values from CardHedger:

| Method | Meaning |
|---|---|
| `direct` | At least one direct PSA-grade sale in the recent window. Most reliable. |
| `card_interpolation` | Estimate derived from prices at adjacent grades (e.g. PSA 9 + Raw used to infer PSA 10). Less reliable; usually correlates with low confidence. |
| `correlated` | Hypothetical — not yet observed, listed for completeness. Likely uses sales of similar (non-same) cards. |

**`estimate_freshness_days`** — also stored, also not displayed in v1.
Indicates the age of the most recent comp the estimate is anchored on.
Useful as a future signal ("data is N months stale") but not surfaced
until we see a concrete UX need.

**Variant** — when `card.variant` is present, the card title renders the
variant string inline after the brand/set name, separated by ` · `:
> "2017 Panini Prizm Football · Blue Wave"

When `variant` is null (cards added pre-migration that haven't been
backfilled, or cards CardHedger doesn't tag with a variant), the suffix is
omitted entirely. Don't render "·" separator without a value.
```

---

## 6. Backfill procedure

### `scripts/backfill-valuations.js` — new file

Local Node script. Connects to RDS Data API and CardHedger; processes one
card at a time with a y/n prompt. Run from the repo root via:

```bash
node scripts/backfill-valuations.js
```

Algorithm:

1. Read every card with a non-null cert_number from the cards table:
   ```sql
   SELECT id, user_id, cert_number, COALESCE(grader, 'PSA') AS grader,
          player_name, year, brand, grade,
          cardhedger_id, estimated_value, variant
   FROM cards
   WHERE cert_number IS NOT NULL
   ORDER BY player_name;
   ```

2. For each card, in sequence (no parallelism — manual approval is per-card):
   1. Call `prices-by-cert` → get authoritative `card_id`
   2. Call `card-details` → get variant + canonical fields
   3. Call `comps` (PSA grade label) → get sales array
   4. Call `price-estimate` → get headline value + range + confidence
   5. Render a per-card report:

      ```
      ────────────────────────────────────────────────────────────
      Card 7 of 19
      ────────────────────────────────────────────────────────────
      DB:  PATRICK MAHOMES II 2017 PANINI PRIZM (cert 42291668)
           cardhedger_id: 1587947849017x...
           estimated_value: $5,397.80
           variant: (none)

      NEW:
           card_id (cert resolved): 1627010526322x...   [⚠ MISMATCH]
           variant: Blue Wave
           estimate_price: $6,155.00 (range $5,540–$6,770, conf 0.40 / Low)
           comps comp_price: $6,479.49 (n=10)
           method: card_interpolation, freshness: 64 days

      Apply this update? [y/n/q]
      ```

   6. Read user input. `y` applies the UPDATE; `n` skips; `q` quits the
      script (already-applied updates remain).

3. Apply UPDATE per-card via RDS Data API:
   ```sql
   UPDATE cards SET
     cardhedger_id           = $1,
     variant                 = $2,
     estimate_price          = $3,
     estimate_price_low      = $4,
     estimate_price_high     = $5,
     estimate_confidence     = $6,
     estimate_method         = $7,
     estimate_freshness_days = $8,
     estimate_last_updated   = NOW(),
     raw_comps               = $9,
     -- stamp as freshly refreshed; the next refresh job will skip this
     -- card for 24 hours per the existing staleness gate.
     value_last_updated      = NOW()
   WHERE id = $10;
   ```

4. Log every applied/skipped/quit decision to a timestamped JSON file in
   `scripts/backfill-logs/` so the audit trail survives the script.

**Pre-run checklist:**

- [ ] Migration 0002 applied + verified
- [ ] Lambda code deployed (so the new write paths are live; the backfill
      writes to the same columns the new pricing flow uses)
- [ ] Snapshot the cards table for emergency restore:
      ```sql
      CREATE TABLE cards_pre_backfill AS SELECT * FROM cards;
      ```
- [ ] Dev server running so you can spot-check a card in the UI between
      approvals if something looks off

**Post-run:**

- Drop the snapshot table after a few days of stable runtime:
  `DROP TABLE cards_pre_backfill;`
- Update CONTEXT.md §10 to record the backfill completion + any per-card
  notes worth keeping.

### Expected scope

- **19 cards with cached cardhedger_id** (per yesterday's sweep).
- **3 known mismatches** (Mahomes Blue Wave, Rodriguez Titanium, Messi
  Mundicromo) need careful y/n review.
- **8 cards with no cardhedger_id** at all — separate path: the backfill
  populates them for the first time. Lower risk, but worth showing the
  proposed values before applying.

Total: ~27 cards to walk through. Estimate 30-60 min including pauses for
spot-checks.

---

## 7. Commit sequence

Order designed so each commit is independently verifiable on production
before the next ships. Every commit on `master` triggers Amplify auto-deploy
for frontend; backend changes need explicit `cdk deploy`.

| # | Commit | Branch | Auto-deploys? | Verification |
|---|---|---|---|---|
| **1** | `db: 0002 add valuation columns + variant` | master | No (SQL file only — manual apply via Query Editor) | `\d cards` in Query Editor shows 8 new columns. |
| **2** | `pricing: add fetchValuation, fetchCardDetails, fetchPriceEstimate (additive only)` | master | No (needs `cdk deploy`) | Test invoke: trigger any pricing-aware Lambda, verify nothing breaks. The new functions are unused until commit 3. |
| **3** | `refresh+add-card+get-cards: switch to fetchValuation, write new columns` | master | No (needs `cdk deploy`) | Trigger a refresh on one card; query DB; confirm new columns populated. Frontend continues to read legacy fields — no UI change yet. |
| **4** | `frontend: surface estimate_price, range, confidence chip, variant in CardModal` | master | Yes (Amplify) | Open a refreshed card in production; see new value/range/chip/variant. Cards not yet refreshed render legacy estimated_value gracefully. |
| **5** | `MASTER.md: add §1.5 valuation confidence + method` | master | No (doc only) | Read the new section. |
| **6** | `scripts: add backfill-valuations.js` (file only, not yet run) | master | No (script not deployed; runs locally) | Code review only. |
| **7** | (No commit — operational step) Run the backfill script with manual approval per card | local | n/a | Each card re-rendered in production; mismatches resolved. |

**Why this order:**

- Schema first (1) so writes don't fail on missing columns.
- Backend additive (2) before consumers (3), so the orchestrator function
  exists when the refresh code starts calling it.
- Backend write paths (3) before frontend reads (4), so the frontend never
  reads NULL when it expects a value (existing cards return NULL until
  refreshed; CardModal must handle NULL — see §4).
- Doc (5) before backfill (6, 7) so the script's intent is reviewable
  against the spec.
- Script committed (6) before run (7) so the run is reproducible if
  anything needs re-doing.

**Steps 1–5 are committable + pushable to production over the course of an
hour.** Steps 6–7 are the slow part (manual approval per card).

---

## 8. Rollback story

| Commit | Rollback | Side effects |
|---|---|---|
| **1 — Schema** | None needed; columns are nullable + unused if other commits revert. To fully roll back: `ALTER TABLE cards DROP COLUMN ...` for each new column. Only do this if a column is causing query plan issues — leaving inert nullable columns is fine. | None. |
| **2 — pricing.js additive** | `git revert <sha>` + `cdk deploy`. Functions become unavailable; nothing else breaks because nothing consumes them yet. | None — purely additive. |
| **3 — refresh + add-card + get-cards** | `git revert <sha>` + `cdk deploy`. Lambdas return to old `fetchMarketValue` path. New columns continue holding whatever was last written; they go stale (no refresh writes), but stale data is inert because frontend isn't reading it (commit 4 hasn't shipped yet, or has been reverted too). | New columns hold last-written values. They don't get refreshed but also don't get cleared. Safe. |
| **4 — frontend CardModal + portfolio.js** | `git revert <sha>`, push to master, Amplify auto-deploys old UI within ~3 min. Backend keeps writing new columns but UI ignores them. | None visible. Estimate columns continue populating for when you fix the UI and re-deploy. |
| **5 — MASTER.md** | `git revert <sha>`. Doc-only, no runtime effect. | None. |
| **6 — Script committed** | `git revert <sha>` removes the file. If the script has been run, applied UPDATEs stay applied — see step 7 rollback. | None until step 7 runs. |
| **7 — Backfill applied** | Per-card rollback from the snapshot table created pre-run: `UPDATE cards SET cardhedger_id = (SELECT cardhedger_id FROM cards_pre_backfill WHERE id = cards.id), variant = NULL, estimate_price = NULL, ...` for any card the user wants reverted. Bulk rollback: `UPDATE cards SET ... = (SELECT ... FROM cards_pre_backfill WHERE id = cards.id)` to restore everything pre-backfill. | Backfill is the riskiest step because it's the only one that overwrites correct data. The snapshot table is the safety net. |

**General principle:** every commit revert is `git revert + push + cdk deploy` (where applicable). No commit destroys data or makes a forward-incompatible change. The schema additions are nullable; the column drops are reversible by re-running the migration.

---

## 9. Open questions

These need a design call before §7's commit 3 is shipped. Most have
recommendations; one or two genuinely require human judgment.

### OQ-1 — Cards added via fuzzy match (no cert)

Current `add-card.js` requires a cert (PSA-only flow today; BGS/SGC routes
through `lookup-cert.js`). The new `fetchValuation` requires a cert as the
entry point. **What about future cards added without a cert** (e.g. raw cards,
manual entry)? Two options:

- (A) Defer: don't accept cert-less cards yet. Same scope as today.
- (B) For cert-less cards, call `card-details` + `price-estimate` directly
  using a cardhedger_id resolved via the existing fuzzy `card-match` path.

**Recommendation: (A).** Cert-less cards are out of scope per the locked
decisions; they'll need a separate spec. Doc this here so it doesn't get
silently expanded.

### OQ-2 — BGS / SGC cards

`prices-by-cert` is PSA-only. BGS and SGC certs go through
`backend/functions/cards/lookup-cert.js`, which calls a different CardHedger
endpoint. **Does the new flow apply only to PSA, or do we extend to all
graders?** Two options:

- (A) PSA-only for v1. Existing `lookup-cert.js` continues handling BGS/SGC.
- (B) Mirror the four-step flow for BGS/SGC by adapting `lookup-cert.js` to
  also call `card-details` + `price-estimate`.

**Recommendation: (A) for the rebuild.** BGS/SGC volume is small (none of
the 19 cards in the sweep are BGS/SGC). Extending is straightforward
follow-up work but adds scope to v1.

### OQ-3 — `estimated_value` deprecation timeline

After backfill, every card has `estimate_price`. **When do we drop
`estimated_value`?** Three options:

- (A) Keep both through initial rollout; revisit deprecation after 90 days
  of stable backfilled data and confirmed A/B parity between comps and
  price-estimate. Disk cost is negligible in the interim.
- (B) Drop after 30 days of stable backfilled data. Adds a 0003 migration.
- (C) Drop in the same migration as the rebuild. Aggressive; assumes
  backfill is bulletproof.

**Recommendation: (A).** Keeping both lets us A/B compare comps vs price-
estimate as CardHedger's data evolves. Cost is one column per card.

### OQ-4 — `manual_price` interaction with `estimate_price`

`updateCardPrice` lets a user override the auto-refreshed value. Today
`refresh-portfolio.js:67-70` skips refresh entirely if `manual_price` is
set. **Does `manual_price` also override `estimate_price`?** Two options:

- (A) Yes — manual overrides everything. UI reads:
  `effectiveValue = manualPrice ?? estimatePrice ?? estimatedValue`
- (B) No — manual overrides only the comps-derived value. UI reads
  `estimatePrice` if present; `manualPrice` is a legacy field.

**Recommendation: (A).** A user setting a manual price is the strongest
signal we have about what they think the card is worth. Suppress all
auto-refresh on either column.

This needs a follow-up edit to `refresh-portfolio.js` and possibly a UI
note explaining "manual override active — automatic estimates suppressed."

### OQ-5 — Variant display on existing (un-backfilled) cards

Until backfill runs, existing cards have `variant = NULL`. The CardModal
must render gracefully:

- Title: render without ` · variant` suffix when variant is null. (Spec
  already says this — confirm in code review.)
- Range: render only when both `estimatePriceLow` and `estimatePriceHigh`
  are present.
- Confidence chip: render only when `estimateConfidence` is present.
- Headline value: fall back to `estimatedValue` when `estimatePrice` is
  null (locked decision).

**Recommendation: write null-safety as a hard rule in the CardModal section
of the implementation. Add unit tests covering the all-null case** so the
UI can't regress here.

### OQ-6 — Confidence chip color choice

Locked decision: word ("Low" / "Medium" / "High"). Color was not
explicitly locked. Spec proposes:

- Low: text-muted slate (#94a3b8) — quiet, signals "not load-bearing"
- Medium: text-secondary slate (#cbd5e1) — neutral
- High: gain green (#34d399) — positive signal

Considered + rejected:

- Red on Low: implies the data is *wrong*. Low confidence is just less
  certain, not bad. Don't editorialize.
- Gold on High: violates gold-scarcity (MASTER §3.2). Brand gold reserved
  for portfolio total + premium tier badges; hero gold reserved for hero
  surfaces.

**Recommendation: ship the slate / slate / green palette as proposed.**
Worth a sanity check after live rendering in dev.

### OQ-7 — What happens when price-estimate fails or returns 0

If `price-estimate` returns null or an obviously-bad value (e.g. 0):

- Don't write 0 into `estimate_price`. Leave the column unchanged so the
  prior estimate (if any) stays valid.
- Don't error the refresh — just skip the estimate update.
- Frontend falls back to `estimatedValue` per the precedence rule.

**Recommendation: defensive write — only update estimate columns when
`price > 0` AND confidence is non-null.** Already implied by the
`fetchPriceEstimate` `if (!res || res.price == null) return null` guard;
formalize in §3 commit.

### OQ-8 — Parallel vs sequential CardHedger calls in `fetchValuation`

Spec uses `Promise.all` for the three follow-up calls (`card-details`,
`comps`, `price-estimate`). Risk: if CardHedger rate-limits, all three
fail simultaneously. Sequential would degrade gracefully (fail one, others
still succeed if rate limits reset between).

**Recommendation: Promise.all for production** — latency matters more than
graceful rate-limit degradation, and the calls are mutually independent.
Add a per-call try/catch (already in spec) so one failure doesn't blow up
the whole valuation. Revisit if rate-limit issues materialize.

---

*End of plan. Awaiting human review before §7 commits begin.*
