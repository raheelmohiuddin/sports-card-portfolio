# Potential Acquisitions — Implementation Plan

> Drafted 2026-05-13. Locked decisions in source prompt. This doc is
> the reference for execution; deviations from it require updating §8
> first. Companion to [mark-as-sold-plan.md](./mark-as-sold-plan.md)
> and [valuation-rebuild-plan.md](./valuation-rebuild-plan.md) — same
> shape, same conventions.

---

## 1. Overview

Today the portfolio has two card buckets: **My Collection** (held cards
the user owns) and **Collection History** (sold/traded exits). The user
can't track cards they *want* to acquire — there's no formal wishlist,
no buy-target tracking, no list to drive future sourcing/consignor
workflows.

This rebuild introduces a third bucket — **Potential Acquisitions**
(PA) — as a first-class peer to My Collection:

1. **Separate table, not a `cards.status` value.** PA rows have a
   different shape: no cost basis, no consignment relationship, no
   sale-state machinery. A new `potential_acquisitions` table avoids
   polluting `cards` with nullable-everywhere columns and keeps the
   "owned" semantic of `cards` intact.
2. **Unified Add Card flow with a bucket toggle.** `/add-card` stays
   as the single entry point; a new toggle at the top selects "My
   Collection" (default) vs "Potential Acquisitions". The cert-lookup
   half is shared; the post-lookup form fields differ per bucket.
3. **Bucket-specific target-price semantics.** `cards.target_price`
   is renamed to `cards.sell_target_price` (per OQ-7 locked, in
   commit 1b) and the UI relabels to **Sell Target** (the
   long-implicit semantic — held cards can only have a sell target).
   PA gets a NEW `buy_target_price` column with explicit naming. Same
   word — "target" — opposite intent; the column and label names
   disambiguate symmetrically.
4. **Move-to-Collection flow.** When the user actually acquires a PA
   card, a single atomic operation copies identity fields into `cards`
   and deletes from `potential_acquisitions`. The realized-acquisition
   surface (DocuSign, consignor sourcing, escrow) is **explicitly out
   of scope for v1** — see ROADMAP "Wishlist → Acquisition flow" L/XL
   entries.

v1 ships the bucket, the list view, add/remove, and move-to-collection.
Nothing else. Price alerts, public sharing, multiple lists, and the
real acquisition workflow are all parked.

---

## 2. Schema changes

Two migrations:

- **0005** (commit 1): additive — creates `potential_acquisitions` and
  adds `cards.wanted_since` (per OQ-2 locked).
- **0006** (commit 1b): renames `cards.target_price` →
  `cards.sell_target_price` (per OQ-7 locked). Ships atomically with
  the matching backend code reads/writes.

`backend/db/migrations/0005_potential_acquisitions.sql`:

```sql
-- 0005_potential_acquisitions.sql
-- Adds the potential_acquisitions table for the "cards I want to buy"
-- bucket. Mirrors the identity + valuation columns from cards so the PA
-- list can render market value alongside the user's buy target. Idempotent
-- (IF NOT EXISTS on the table and the index).

CREATE TABLE IF NOT EXISTS potential_acquisitions (
  -- ─── Identity ────────────────────────────────────────────────────
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- ─── Card identity (mirrors cards) ───────────────────────────────
  -- cert_number nullable to future-proof for non-cert / raw cards
  -- (current Add Card flow is cert-first PSA-only, so this will be
  -- populated in practice but we don't enforce it at the DB).
  cert_number         varchar(50),
  grader              text,
  year                varchar(10),
  brand               varchar(100),
  sport               varchar(100),
  category            varchar(100),
  player_name         varchar(255),
  card_number         varchar(100),
  grade               varchar(10),
  grade_description   varchar(200),
  variant             varchar(100),
  psa_population         integer,
  psa_population_higher  integer,

  -- ─── PA-specific fields ──────────────────────────────────────────
  buy_target_price    numeric(10,2),
  notes               text,
  -- priority is future-use (high/medium/low). v1 UI doesn't surface
  -- it; column reserved so we don't need another migration when it
  -- does. Free-text rather than enum so values can iterate without
  -- migration churn.
  priority            text,

  -- ─── Valuation (mirrors cards' valuation columns) ────────────────
  -- We want PA tiles to show current market value vs the user's buy
  -- target, so the same valuation pipeline (refresh-portfolio.js +
  -- pricing.js#fetchValuation) populates these. Same columns, same
  -- semantics as cards — refresh-portfolio.js gains a second pass
  -- over PA rows; pricing.js untouched.
  estimated_value           numeric(10,2),
  avg_sale_price            numeric(10,2),
  last_sale_price           numeric(10,2),
  num_sales                 integer,
  price_source              varchar(20),
  value_last_updated        timestamptz,
  cardhedger_id             text,
  cardhedger_image_url      text,
  raw_comps                 jsonb,
  estimate_price            numeric(10,2),
  estimate_price_low        numeric(10,2),
  estimate_price_high       numeric(10,2),
  estimate_confidence       numeric(5,4),
  estimate_method           varchar(40),
  estimate_freshness_days   integer,
  estimate_last_updated     timestamptz,

  -- ─── Timestamps ─────────────────────────────────────────────────
  added_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

-- Duplicate prevention: same (user, cert) pair can't appear twice in PA.
-- Cross-bucket duplicate (cert is already in cards) is enforced at the
-- Lambda layer, not the DB, since the two tables are independent. See
-- OQ-6 for the cross-bucket-uniqueness decision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pa_user_cert_unique
  ON potential_acquisitions (user_id, cert_number)
  WHERE cert_number IS NOT NULL;

-- Lookup index for the dashboard list query.
CREATE INDEX IF NOT EXISTS idx_pa_user_added
  ON potential_acquisitions (user_id, added_at DESC);

-- ─── cards.wanted_since (per OQ-2 locked) ──────────────────────────────
-- When a PA row moves to cards via move-to-collection.js, the original
-- added_at is preserved here so the card carries its "wanted since"
-- history. NULL for cards added before this feature (no PA history).
-- Display: CardModal sidebar only — not surfaced on tile.
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS wanted_since timestamptz NULL;
```

`backend/db/migrations/0006_rename_target_price.sql`:

```sql
-- 0006_rename_target_price.sql
-- Per OQ-7 locked: rename cards.target_price to cards.sell_target_price
-- for schema-and-code symmetry with potential_acquisitions.buy_target_price.
-- Ships atomically with the matching backend code reads/writes (commit 1b).
-- Frontend variable rename (targetPrice → sellTargetPrice) is part of
-- commit 3; visible UI label rename ("Target Price" → "Sell Target") is
-- part of commit 5.

ALTER TABLE cards RENAME COLUMN target_price TO sell_target_price;
```

**Why these column types:**

| Column | Type | Rationale |
|---|---|---|
| All identity fields | Mirror `cards` exactly | A PA row converted to a card row should be a 1:1 column copy (see `move-to-collection.js`). |
| `buy_target_price` | `numeric(10,2)` | Same shape as `cards.target_price` and `cards.my_cost`. |
| `priority` | `text` | Free-text not enum — UI iteration without migration. |
| All valuation fields | Mirror `cards` valuation columns | Same `fetchValuation` pipeline, same response shape, same UI consumers. |
| `cert_number` | nullable `varchar(50)` | Future-proofing for non-cert raw cards; partial unique index only fires when present. |

**Apply via Query Editor** (per CONTEXT.md §11). Verify with:

```sql
SELECT table_name, column_count FROM (
  SELECT table_name, COUNT(*) AS column_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'potential_acquisitions'
  GROUP BY table_name
) c;

SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'potential_acquisitions';
```

Expected: 1 table with ~30 columns; 3 indexes (PK + 2 named).

---

## 3. Backend changes (file-by-file)

### `backend/functions/potential-acquisitions/add-pa.js` — NEW

Collector POST `/potential-acquisitions`. Mirrors `cards/add-card.js`
structurally but persists to the new table, skips cost-basis fields,
and runs the same valuation pipeline.

**`fetchValuation` runs pre-INSERT per OQ-11.** Wrapped in try/catch.
On success, the result populates the `cardhedger_id` field used for
the OQ-6 cross-bucket match check. On CardHedger outage, the catch
path logs the failure and proceeds with cert-only matching + INSERT —
the PA row lands without valuation enrichment and
`refresh-portfolio.js` will populate it on next refresh.

```js
// POST /potential-acquisitions
// Creates a PA row from a cert lookup + optional buy_target_price.
// Mirrors add-card.js: validates body, INSERT ON CONFLICT DO NOTHING,
// then fires fetchValuation to populate estimate_price + raw_comps.
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidCertNumber, sanitize, isValidPrice, isValidCount } = require("../_validate");
const { fetchValuation } = require("../portfolio/pricing");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const {
    certNumber, year, brand, sport, category, playerName, cardNumber,
    grade, gradeDescription,
    psaPopulation, psaPopulationHigher,
    buyTargetPrice, notes, priority,
    grader,
  } = body;

  if (!isValidCertNumber(certNumber)) {
    return json(400, { error: "certNumber is required and must be 1–30 alphanumeric characters" });
  }
  if (!isValidCount(psaPopulation) || !isValidCount(psaPopulationHigher)) {
    return json(400, { error: "psaPopulation values must be non-negative integers" });
  }
  const targetProvided = buyTargetPrice !== null && buyTargetPrice !== undefined && buyTargetPrice !== "";
  if (targetProvided && !isValidPrice(buyTargetPrice)) {
    return json(400, { error: "buyTargetPrice must be a non-negative number under 10,000,000" });
  }
  const buyTargetValue = targetProvided ? parseFloat(buyTargetPrice) : null;
  const graderValue = ["PSA", "BGS", "SGC"].includes(grader) ? grader : "PSA";

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // INSERT with ON CONFLICT DO NOTHING — matches cards' duplicate-prevention
  // pattern. Returns 0 rows if the cert is already in this user's PA list.
  const result = await db.query(
    `INSERT INTO potential_acquisitions
       (user_id, cert_number, grader, year, brand, sport, category, player_name,
        card_number, grade, grade_description, psa_population, psa_population_higher,
        buy_target_price, notes, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (user_id, cert_number) DO NOTHING
     RETURNING id`,
    [
      userId, certNumber.trim(), graderValue,
      sanitize(year, 10), sanitize(brand, 200), sanitize(sport, 100),
      sanitize(category, 100), sanitize(playerName, 300),
      sanitize(cardNumber, 100), sanitize(grade, 10),
      sanitize(gradeDescription, 200),
      psaPopulation != null ? parseInt(psaPopulation, 10) : null,
      psaPopulationHigher != null ? parseInt(psaPopulationHigher, 10) : null,
      buyTargetValue,
      sanitize(notes, 2000),
      sanitize(priority, 20),
    ]
  );

  if (result.rows.length === 0) {
    const existing = await db.query(
      "SELECT id FROM potential_acquisitions WHERE user_id = $1 AND cert_number = $2",
      [userId, certNumber.trim()]
    );
    return json(409, {
      error: "This card is already in your Potential Acquisitions list",
      existingPaId: existing.rows[0]?.id ?? null,
    });
  }

  const paId = result.rows[0].id;

  // Reuse the same valuation pipeline as add-card.js so PA tiles can
  // render "current market value vs your buy target" from day one.
  const valuation = await fetchValuation({
    certNumber, grader: graderValue, grade,
  }).catch((err) => {
    console.warn("[add-pa] valuation fetch failed:", err.message);
    return null;
  });

  if (valuation) {
    await db.query(
      `UPDATE potential_acquisitions SET
         estimated_value         = COALESCE($1, estimated_value),
         avg_sale_price          = $1,
         last_sale_price         = $2,
         num_sales               = $3,
         price_source            = 'cardhedger',
         cardhedger_id           = $4,
         cardhedger_image_url    = COALESCE($5, cardhedger_image_url),
         raw_comps               = $6,
         value_last_updated      = NOW(),
         estimate_price          = $7,
         estimate_price_low      = $8,
         estimate_price_high     = $9,
         estimate_confidence     = $10,
         estimate_method         = $11,
         estimate_freshness_days = $12,
         estimate_last_updated   = NOW(),
         variant                 = COALESCE($13, variant),
         category                = COALESCE($14, category)
       WHERE id = $15`,
      [
        valuation.comps?.avgSalePrice ?? null,
        valuation.comps?.lastSalePrice ?? null,
        valuation.comps?.numSales ?? 0,
        valuation.cardhedgerId ?? null,
        valuation.cardhedgerImageUrl ?? null,
        JSON.stringify(valuation.comps?.rawComps ?? []),
        valuation.estimate?.price ?? null,
        valuation.estimate?.priceLow ?? null,
        valuation.estimate?.priceHigh ?? null,
        valuation.estimate?.confidence ?? null,
        valuation.estimate?.method ?? null,
        valuation.estimate?.freshnessDays ?? null,
        valuation.variant ?? null,
        valuation.category ?? null,
        paId,
      ]
    );
  }

  return json(201, { id: paId });
};
```

### `backend/functions/potential-acquisitions/list-pas.js` — NEW

Collector GET `/potential-acquisitions`. Returns the user's full PA
list, oldest-to-newest by `added_at` (matches `get-cards.js`'s ORDER
BY pattern, just no consignment joins).

```js
// GET /potential-acquisitions — user's full PA list
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, cert_number, grader, year, brand, sport, category, player_name,
            card_number, grade, grade_description, variant,
            psa_population, psa_population_higher,
            buy_target_price, notes, priority,
            estimated_value, avg_sale_price, last_sale_price, num_sales,
            price_source, value_last_updated,
            cardhedger_image_url,
            estimate_price, estimate_price_low, estimate_price_high,
            estimate_confidence, estimate_method,
            estimate_freshness_days, estimate_last_updated,
            added_at
     FROM potential_acquisitions
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [userId]
  );

  // Response shape mirrors get-cards.js per-card object so the
  // frontend tile component can be reused with minimal branching.
  const pas = result.rows.map((row) => ({
    id:                row.id,
    certNumber:        row.cert_number,
    grader:            row.grader ?? "PSA",
    year:              row.year,
    brand:             row.brand,
    sport:             row.sport,
    category:          row.category ?? null,
    playerName:        row.player_name,
    cardNumber:        row.card_number,
    grade:             row.grade,
    gradeDescription:  row.grade_description,
    variant:           row.variant ?? null,
    psaPopulation:        row.psa_population ?? null,
    psaPopulationHigher:  row.psa_population_higher ?? null,
    buyTargetPrice:    row.buy_target_price ? parseFloat(row.buy_target_price) : null,
    notes:             row.notes ?? null,
    priority:          row.priority ?? null,
    estimatedValue:    row.estimated_value ? parseFloat(row.estimated_value) : null,
    avgSalePrice:      row.avg_sale_price  ? parseFloat(row.avg_sale_price)  : null,
    lastSalePrice:     row.last_sale_price ? parseFloat(row.last_sale_price) : null,
    numSales:          row.num_sales ?? null,
    priceSource:       row.price_source ?? null,
    valueLastUpdated:  row.value_last_updated ?? null,
    cardhedgerImageUrl: row.cardhedger_image_url ?? null,
    estimatePrice:         row.estimate_price ? parseFloat(row.estimate_price) : null,
    estimatePriceLow:      row.estimate_price_low ? parseFloat(row.estimate_price_low) : null,
    estimatePriceHigh:     row.estimate_price_high ? parseFloat(row.estimate_price_high) : null,
    estimateConfidence:    row.estimate_confidence != null ? parseFloat(row.estimate_confidence) : null,
    estimateMethod:        row.estimate_method ?? null,
    estimateFreshnessDays: row.estimate_freshness_days ?? null,
    estimateLastUpdated:   row.estimate_last_updated ?? null,
    addedAt:           row.added_at,
  }));

  return json(200, pas);
};
```

### `backend/functions/potential-acquisitions/delete-pa.js` — NEW

Collector DELETE `/potential-acquisitions/{id}`. Hard-delete (locked
choice — see OQ-1 for the soft-vs-hard rationale).

```js
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const paId = event.pathParameters?.id;
  if (!isValidId(paId)) return json(400, { error: "Invalid PA id" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Ownership check via the WHERE clause — anyone trying to delete
  // another user's PA gets a 0-row result and a 404.
  const result = await db.query(
    "DELETE FROM potential_acquisitions WHERE id = $1 AND user_id = $2 RETURNING id",
    [paId, userId]
  );
  if (result.rowCount === 0) return json(404, { error: "PA not found" });

  return json(200, { id: paId, deleted: true });
};
```

### `backend/functions/potential-acquisitions/move-to-collection.js` — NEW

Collector POST `/potential-acquisitions/{id}/move`. Atomic transfer
from PA to cards. Body carries the cost basis (and optional sell
target) the user is recording at acquisition time.

**Per OQ-2, the `INSERT...SELECT` into cards includes `wanted_since`
as a new column, sourced from the PA row's `added_at`.** Schema adds
nullable `cards.wanted_since timestamptz` column in commit 1's
migration (0005). The code-sample below reflects the pre-OQ-2 column
list — add `wanted_since` to both the INSERT target list and the
SELECT source list (right after `card_number` is fine, or grouped
with the timestamp columns at the end).

```js
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidPrice } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const paId = event.pathParameters?.id;
  if (!isValidId(paId)) return json(400, { error: "Invalid PA id" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { myCost, sellTargetPrice } = body;

  // Both fields optional. The user might know the cost but not yet
  // care about a sell target — allow either to be omitted.
  const costProvided = myCost !== null && myCost !== undefined && myCost !== "";
  if (costProvided && !isValidPrice(myCost)) {
    return json(400, { error: "myCost must be a non-negative number under 10,000,000" });
  }
  const myCostValue = costProvided ? parseFloat(myCost) : null;

  const targetProvided = sellTargetPrice !== null && sellTargetPrice !== undefined && sellTargetPrice !== "";
  if (targetProvided && !isValidPrice(sellTargetPrice)) {
    return json(400, { error: "sellTargetPrice must be a non-negative number under 10,000,000" });
  }
  const sellTargetValue = targetProvided ? parseFloat(sellTargetPrice) : null;

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Single-statement transfer: copy the PA row's identity + valuation
  // fields into cards in one SQL, then DELETE the PA row in the same
  // transaction. INSERT...SELECT...RETURNING preserves valuation work
  // (raw_comps, estimate_price, etc.) so the new card lands fully
  // populated without re-running fetchValuation.
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Verify PA exists and is owned by the caller before transferring.
    const paRow = await client.query(
      "SELECT id FROM potential_acquisitions WHERE id = $1 AND user_id = $2",
      [paId, userId]
    );
    if (paRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return json(404, { error: "PA not found" });
    }

    // INSERT via SELECT from the PA row — copies every shared column.
    // ON CONFLICT (user_id, cert_number) DO NOTHING handles the rare
    // case where the user already has this cert in cards (race or
    // direct DB write); we return 409 in that case.
    const insertResult = await client.query(
      `INSERT INTO cards
         (user_id, cert_number, grader, year, brand, sport, category, player_name,
          card_number, grade, grade_description, variant,
          psa_population, psa_population_higher,
          my_cost, target_price,
          estimated_value, avg_sale_price, last_sale_price, num_sales,
          price_source, value_last_updated,
          cardhedger_id, cardhedger_image_url, raw_comps,
          estimate_price, estimate_price_low, estimate_price_high,
          estimate_confidence, estimate_method,
          estimate_freshness_days, estimate_last_updated)
       SELECT
          user_id, cert_number, grader, year, brand, sport, category, player_name,
          card_number, grade, grade_description, variant,
          psa_population, psa_population_higher,
          $1, $2,
          estimated_value, avg_sale_price, last_sale_price, num_sales,
          price_source, value_last_updated,
          cardhedger_id, cardhedger_image_url, raw_comps,
          estimate_price, estimate_price_low, estimate_price_high,
          estimate_confidence, estimate_method,
          estimate_freshness_days, estimate_last_updated
       FROM potential_acquisitions
       WHERE id = $3 AND user_id = $4
       ON CONFLICT (user_id, cert_number) DO NOTHING
       RETURNING id`,
      [myCostValue, sellTargetValue, paId, userId]
    );

    if (insertResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return json(409, {
        error: "This cert is already in your collection",
      });
    }

    const newCardId = insertResult.rows[0].id;

    await client.query(
      "DELETE FROM potential_acquisitions WHERE id = $1 AND user_id = $2",
      [paId, userId]
    );

    await client.query("COMMIT");

    return json(200, {
      newCardId,
      removedPaId: paId,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};
```

### `backend/functions/cards/add-card.js` — gains PA-detection branch

Per OQ-6 locked, `add-card.js` gains a PA-detection branch BEFORE its
INSERT. Sequence:

(a) Run `fetchValuation` per OQ-11 (graceful degradation pattern).
(b) Run match query against `potential_acquisitions` (cardhedger_id
    with cert fallback):

```sql
SELECT id, cert_number, year, brand, player_name, grade, added_at
FROM potential_acquisitions
WHERE user_id = $1
  AND (
    (cardhedger_id IS NOT NULL AND cardhedger_id = $2)
    OR
    ((cardhedger_id IS NULL OR $2 IS NULL) AND cert_number = $3)
  )
LIMIT 1;
```

(c) If a PA match is found, return the special response shape:

```json
{
  "status": "pa_match_found",
  "paId": "<uuid>",
  "paDetails": {
    "year": "2023",
    "brand": "...",
    "playerName": "...",
    "grade": "10",
    "addedAt": "2026-04-20T..."
  }
}
```

(d) If no match, proceed with the existing INSERT path. Still accepts
    `targetPrice` from the body — verified during recon, no change
    needed for the cards-INSERT path itself (note: column is now
    `sell_target_price` per commit 1b; the JS body field name becomes
    `sellTargetPrice` per OQ-7).

Frontend handles `pa_match_found` by showing a confirmation modal and
either calling `/potential-acquisitions/{paId}/move` (confirmed) with
the `myCost` + `sellTargetPrice` from the add form, or aborting
(cancelled — no DB write).

**Per OQ-12, this match logic applies to PA detection only.**
`add-card.js` still permits multiple cards with the same
`cardhedger_id` when no PA row exists (trade-bait dupes are
intentional collection behavior).

### `backend/functions/portfolio/refresh-portfolio.js` — extend to PA rows

`refresh-portfolio.js` currently iterates over `cards` for staleness-
gated re-valuation. Extend the same loop to also iterate over
`potential_acquisitions`. Same staleness rule (24h since last update),
same `fetchValuation` call, same write columns. Only the target table
differs.

Implementation: factor the per-row work into a helper, call it twice
— once with `cards`, once with `potential_acquisitions`. Or run two
SELECT-then-loop blocks, whichever feels cleaner once the file is
open.

### `infrastructure/lib/api-stack.ts` — register 4 new Lambdas + routes

Mirror the `MarkSold` / `CreateConsignment` patterns. Four additions:

1. **Lambda definitions** (alongside `markSoldFn` ~L457):
   ```ts
   const addPaFn = new NodejsFunction(this, "AddPa", {
     ...sharedNodejsProps,
     functionName: "scp-add-pa",
     entry: path.join(functionsDir, "potential-acquisitions/add-pa.js"),
   });
   const listPasFn = new NodejsFunction(this, "ListPas", { /* ... list-pas.js ... */ });
   const deletePaFn = new NodejsFunction(this, "DeletePa", { /* ... delete-pa.js ... */ });
   const movePaToCollectionFn = new NodejsFunction(this, "MovePaToCollection",
     { /* ... move-to-collection.js ... */ });
   ```

2. **DB grants array** (L543 spread list): append all four to the
   `for (const fn of [...])` loop alongside the existing card mutators.

3. **Route registrations**:
   ```ts
   httpApi.addRoutes({
     path: "/potential-acquisitions",
     methods: [apigwv2.HttpMethod.GET],
     integration: new apigwv2integrations.HttpLambdaIntegration("ListPas", listPasFn),
     ...authRoute,
   });
   httpApi.addRoutes({
     path: "/potential-acquisitions",
     methods: [apigwv2.HttpMethod.POST],
     integration: new apigwv2integrations.HttpLambdaIntegration("AddPa", addPaFn),
     ...authRoute,
   });
   httpApi.addRoutes({
     path: "/potential-acquisitions/{id}",
     methods: [apigwv2.HttpMethod.DELETE],
     integration: new apigwv2integrations.HttpLambdaIntegration("DeletePa", deletePaFn),
     ...authRoute,
   });
   httpApi.addRoutes({
     path: "/potential-acquisitions/{id}/move",
     methods: [apigwv2.HttpMethod.POST],
     integration: new apigwv2integrations.HttpLambdaIntegration("MovePaToCollection",
       movePaToCollectionFn),
     ...authRoute,
   });
   ```

REST conventions match the rest of the app: GET list, POST create,
DELETE single, POST sub-action on single.

---

## 4. Frontend changes (file-by-file)

### `frontend/src/services/api.js` — 4 new API methods

Append after `addCard` / `updateCard` (the collection write methods)
for logical grouping:

```js
// ─── Potential Acquisitions ───────────────────────────────────────────
export async function getPotentialAcquisitions() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function addPotentialAcquisition(payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function deletePotentialAcquisition(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function movePotentialAcquisitionToCollection(id, { myCost, sellTargetPrice }) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions/${id}/move`, {
    method: "POST",
    headers,
    body: JSON.stringify({ myCost, sellTargetPrice }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}
```

### `frontend/src/components/Layout.jsx` — new dropdown item

Inside the Portfolio dropdown (`Layout.jsx:209-219`), add a new
`PortfolioMenuItem` between "Collection History" and the divider:

```jsx
<PortfolioMenuItem label="Dashboard"               onClick={() => go("/portfolio?tab=dashboard")} />
<PortfolioMenuItem label="My Collection"           onClick={() => go("/portfolio?tab=collection")} />
<PortfolioMenuItem label="Collection History"      onClick={() => go("/portfolio?tab=past")} />
<PortfolioMenuItem label="Potential Acquisitions"  onClick={() => go("/portfolio?tab=potential")} />
<div style={st.portfolioMenuDivider} />
<PortfolioMenuItem
  label={<><span style={st.portfolioMenuActionIcon}>+</span> Add a Card</>}
  onClick={() => go("/add-card")}
  action
/>
```

One-line addition. No new styles. The dropdown grows by one row.

### `frontend/src/pages/PortfolioPage.jsx` — new tab + tile grid

Two changes:

1. **Tab registration**: extend the `?tab=` parsing + tab button row
   to include `"potential"`. The existing pattern (per the recon)
   has Dashboard / My Collection / Collection History. Add a fourth.

2. **Tab content**: new section that fetches via
   `getPotentialAcquisitions()` on mount and renders a tile grid.
   The tile component is structurally similar to the existing
   `CardTile` (image, identity, value); PA-specific bits:
   - **Buy Target** display alongside current estimated value
   - **Delta** between value and buy target (positive = at/above
     target, negative = below)
   - **Actions**: `Move to Collection` button + `Remove from PA`
     button (with confirm)
   - **No SOLD ribbon, no consign block, no Mark as Sold** — PA
     cards aren't owned, so the sold-state machinery is irrelevant.

   Suggested approach: create a new `PaCardTile` component
   (`components/PaCardTile.jsx`) that wraps the shared image/identity
   chrome from CardTile but renders PA-specific data + actions. Keeps
   the existing CardTile untouched and avoids prop-bloat with bucket
   branching.

3. **Move-to-Collection modal**: new component
   (`components/MoveToCollectionModal.jsx`) opened by the tile's
   "Move to Collection" button. Captures `my_cost` (required) and
   `sell_target_price` (optional). Submits to
   `movePotentialAcquisitionToCollection(id, { myCost, sellTargetPrice })`.
   On success: closes modal, removes the PA tile from the grid,
   shows a brief success toast or auto-navigates to
   `/portfolio?tab=collection&highlight=<newCardId>` so the user sees
   their new card in My Collection.

### `frontend/src/pages/AddCardPage.jsx` — bucket toggle + bucket-specific fields

Three changes:

1. **Bucket toggle at the top of the form**: segmented control with
   two options — "My Collection" (default) and "Potential
   Acquisitions". State: `const [bucket, setBucket] = useState("collection")`.
   Styled like the existing grader tabs at line 144-160.

2. **Bucket-specific form fields after cert lookup**:
   - When `bucket === "collection"`: existing My Cost input PLUS a
     new **Sell Target Price** input (currently only editable
     post-add via EditCostModal).
   - When `bucket === "potential"`: a single **Buy Target Price**
     input (no cost field).

3. **Submit dispatch**: in `handleSave`, branch on `bucket`:
   - `"collection"`: existing `addCard(...)` call, now also sends
     `targetPrice` (the API field name stays `targetPrice` per recon
     §6c; the visible label is "Sell Target Price").
   - `"potential"`: new `addPotentialAcquisition(...)` call with the
     same cert/identity payload plus `buyTargetPrice`. On success,
     navigate to `/portfolio?tab=potential` instead of `?tab=collection`.

Header copy and subtitle also adjust per bucket — the existing
"Add to Your Collection" reads off for the PA bucket. A small
copy variant ("Add to Your Potential Acquisitions") is fine.

### `frontend/src/components/CardModal.jsx` — minor, see §5

CardModal's "Target Price" section header is one of the UI relabels.
No structural change; just the label string. Listed in §5 inventory.

---

## 5. UI label rename inventory — "Target Price" → "Sell Target"

Per the recon, six concrete file:line sites display the legacy
"Target Price" label. All are within `cards` / `My Collection`
surfaces — the new PA bucket gets "Buy Target" from day one without
touching these.

**Per OQ-7 locked, the rename inventory splits across two commits:**

- **Commit 3** (touched anyway): JS variable renames — `targetPrice`
  → `sellTargetPrice`. Bundled here because commit 3 already touches
  the cards data layer for the PA list view.
- **Commit 5** (cosmetic): visible UI label text changes — "Target
  Price" → "Sell Target" at each `file:line` site below.

The schema column rename (`cards.target_price` →
`cards.sell_target_price`) and matching backend code reads/writes
ship atomically in **commit 1b** (migration 0006). See §2 + §6.

| # | File:line | Current | New |
|---|---|---|---|
| 1 | `CardModal.jsx:346` | Section header **"Target Price"** | **"Sell Target"** (or "Sell Target Price" if width permits) |
| 2 | `PortfolioPage.jsx:1261` | Edit modal field label **"Target Price"** | **"Sell Target Price"** |
| 3 | `PortfolioPage.jsx:1671` | Tile badge `title="Target hit · $X"` | `title="Sell target hit · $X"` |
| 4 | `PortfolioPage.jsx:1887` | Alert banner comment / heading | Update banner copy to **"sell target"** |
| 5 | `PortfolioPage.jsx:1895` | `"{n} cards hit target price"` | `"{n} cards hit sell target"` |
| 6 | `SettingsPage.jsx:127` | `"Get emails when target prices are hit and milestones are achieved."` | `"Get emails when sell targets are hit and milestones are achieved."` |
| 7 | `AddCardPage.jsx:196` | Duplicate alert mentions *"…update cost, target price, or remove it."* | *"…update cost, sell target, or remove it."* |

Also worth checking but lower confidence (recon didn't surface these
explicitly):

- The "TARGET" corner ribbon on tiles (`PortfolioPage.jsx` ~line
  1665-1675 area). Probably stays as the single word "TARGET" since
  the bucket context (My Collection vs PA) disambiguates; renaming
  to "SELL TARGET" doubles the character count and may not fit the
  ribbon. **Recommendation: leave as "TARGET" for the cards-bucket
  ribbon.**
- Any column sort or filter UI that references "target price" — grep
  the PortfolioPage sort dropdown when implementing.

Per OQ-7 locked: schema column rename ships atomically with backend
code reads/writes in **commit 1b**. JS variable rename
(`targetPrice` → `sellTargetPrice`) ships in **commit 3**. Only
visible UI label text changes ship in **commit 5** (the inventory
above).

---

## 6. Commit sequence

Same ordering principle as the mark-as-sold rollout: schema first,
backend next, frontend last. Each commit independently verifiable.
Amplify auto-deploys frontend; backend needs explicit `cdk deploy`.

| # | Commit | Branch | Auto-deploys? | Verification |
|---|---|---|---|---|
| **1** | `db: 0005 add potential_acquisitions table + cards.wanted_since column` | master | No (SQL only — manual apply via Query Editor) | Verify queries from §2 return ~30 columns + 3 indexes on `potential_acquisitions`. Verify `cards.wanted_since` exists as nullable `timestamptz`. Insert a throwaway test row via psql to confirm constraints work, then DELETE. |
| **1b** | `db: 0006 rename cards.target_price → sell_target_price + all backend reads/writes` | master | Mixed (SQL via Query Editor + `cdk deploy` for backend code) | Apply ALTER TABLE via Query Editor; verify `\d cards` shows the new column name and `target_price` is gone. Code: grep the backend for any remaining `target_price` references — should be zero. `cdk deploy`, then exercise a card refresh via `/portfolio/refresh` and a manual `/cards/{id}` UPDATE to verify the new column is read + written correctly. |
| **2** | `potential-acquisitions: add 4 Lambdas + register in api-stack` | master | No (needs `cdk deploy`) | `cdk diff` shows 4 new Lambda functions + 4 new routes. Test invoke each via curl/Postman (or `aws lambda invoke` with synthetic events). Expect 401 on no-auth, then exercise the happy paths once the schema is in place. |
| **3** | `frontend: PA tab + list view + targetPrice → sellTargetPrice variable renames` | master | Yes (Amplify) | After deploy, hit `/portfolio?tab=potential` in browser. Empty-state renders (no PA rows yet). Layout dropdown shows the new menu item. No regression in other tabs. Grep the frontend for any remaining `targetPrice` references — should be zero (visible labels untouched, those ship in commit 5). |
| **4** | `frontend: AddCardPage bucket toggle + bucket-specific fields + image uploads + confirmation modal` | master | Yes (Amplify) | Open `/add-card`. Toggle to Potential Acquisitions, do a cert lookup, optionally upload front + back images, set a Buy Target, submit. Card appears in `/portfolio?tab=potential` with the user-uploaded image (or CardHedger image if no upload). Toggle back to My Collection, add another card with My Cost + Sell Target. Card appears in My Collection with the sell target visible. Add a card that's already in your PA list — confirmation modal appears with PA details; clicking Confirm moves the PA row to cards. |
| **5** | `frontend: rename "Target Price" → "Sell Target" UI labels + ROADMAP update` | master | Yes (Amplify) | All seven file:line touchpoints from §5 inventory show the new label. Verify the EditCostModal field, CardModal section header, alert banner copy, settings email-pref copy. Also confirms ROADMAP "Wishlist" entries renamed to "Potential Acquisitions". |

**Why this order:**

- **Schema first (1):** PA Lambdas would fail on missing table. Frontend can't render data that doesn't exist. Migration must precede everything. `cards.wanted_since` is bundled here (per OQ-2) because it's a `cards`-table additive change with no separate risk profile.
- **Commit 1b isolates rename risk from PA additions.** Either commit can revert independently. **Schema rename + backend rename ship atomically in 1b** to avoid "DB column renamed but code still reads old column" states — partial rollback (reverting only the SQL or only the code) leaves the deploy broken. The two-step apply (Query Editor SQL, then `cdk deploy`) needs the user to coordinate; do not push commit 2 until 1b is verified live.
- **Backend before frontend (2 before 3, 4):** The frontend reads/writes via the new endpoints; they must be deployed before the frontend can exercise them.
- **List view before add flow (3 before 4):** Commit 3 ships the read path; commit 4 ships the write path. Splitting them lets us verify the empty-state PA list renders cleanly before introducing data, and gives commit 4 a clear "I see my newly-added PA in the list" verification path.
- **Commit 3 absorbs the frontend variable rename** because it's already touching the cards data layer (PA list reuses CardTile + shared API plumbing). Bundling the rename keeps commit 5 strictly cosmetic.
- **Commit 5 stays scoped to visible UI labels only.** No JS variable changes, no schema changes, no risk surface beyond display strings.

**Steps 1–5 are committable + deployable over a single session** (1b adds a short manual-SQL step between 1 and 2, plus a `cdk deploy` round-trip).

---

## 7. Rollback story

| Commit | Rollback | Side effects |
|---|---|---|
| **1 — Schema** | `DROP TABLE IF EXISTS potential_acquisitions CASCADE;` + `DROP INDEX IF EXISTS idx_pa_user_cert_unique; DROP INDEX IF EXISTS idx_pa_user_added;` + `ALTER TABLE cards DROP COLUMN IF EXISTS wanted_since;` Only needed if rollback is required *before* any PA rows are added — once users have data, prefer to leave the table in place. | If PA rows exist, DROP TABLE loses them. `cards.wanted_since` is empty pre-feature, so dropping it is safe. Pre-prod safe; production should snapshot first. |
| **1b — Schema rename + backend rename** | `git revert <sha>` (restores backend code reading from `target_price`) + `cdk deploy` + manual `ALTER TABLE cards RENAME COLUMN sell_target_price TO target_price;` (restores column name). **Both must happen together** — partial rollback (only SQL or only code) leaves code and schema misaligned and breaks the deploy. Coordinate the SQL apply with the `cdk deploy` to minimize the misaligned window. | No data loss — column rename preserves values. Brief window of misalignment between SQL apply and `cdk deploy` completing; users on the cards path during that window may see 500s. |
| **2 — Backend Lambdas + routes** | `git revert <sha>` + `cdk deploy`. 4 Lambdas + 4 routes go away. In-flight POSTs would fail with 404. | Any in-flight or queued client requests fail. No data state to clean up unless frontend already shipped (it hasn't at this point). |
| **3 — Frontend list view** | `git revert <sha>`, push, Amplify deploys old UI in ~3 min. The PA tab/link disappears; backend stays live. | Data in `potential_acquisitions` is preserved; users just can't see it until the frontend is re-deployed. |
| **4 — AddCardPage bucket toggle** | `git revert <sha>`, push, Amplify. Add Card reverts to single-bucket My-Collection-only behavior. Existing PA rows still visible in the PA tab (commit 3 still live). New cards can't be added to PA via the UI. | No data loss. The PA add path is unavailable until re-shipped. |
| **5 — UI label renames** | `git revert <sha>`, push, Amplify. UI labels revert to "Target Price". Functionality unchanged. | None. Pure visual rollback. |

**General principle:** schema is the only commit that touches data;
all others are pure code + IaC. Reverts are safe in any order
post-deploy, with the caveat that reverting commit 1 (schema) while
later commits still reference the table breaks deploys until 2/3/4
are also reverted.

**Hardest rollback to reason about:** if PA users exist and you
revert commit 4, those users keep the PA rows they created (commit
3 still renders them) but can't add new ones. If they want to
abandon the feature entirely, run a one-line `TRUNCATE
potential_acquisitions` before dropping the table. Otherwise the
data sits idle until the feature ships again.

---

## 8. Open questions

**All locked 2026-05-13.** This section is preserved as the
decision-trail for each design call. Each "Locked:" paragraph is the
binding instruction for §6 execution — deviations from it require
updating §8 first per the doc convention at the top of this file.

### OQ-1 — Soft-delete vs hard-delete for `delete-pa`

Spec uses hard DELETE. Alternatives:

- (A) **Hard delete** — `DELETE FROM potential_acquisitions WHERE ...`. **Spec'd.** Row gone, no recovery from UI.
- (B) **Soft delete** — add `deleted_at timestamptz`, set on "delete". Allows undo, audit, and analytics ("things I changed my mind about").
- (C) **Hard delete + audit log table** — separate `pa_history` table receives a row on every delete/move. Heavier but separates concerns.

**Locked: (A).** Hard delete. Users curate their PA list freely;
soft-delete clutter isn't useful. Trigger for soft-delete
reconsideration: first user complaint about an accidental delete.

### OQ-2 — Move-to-Collection: preserve `added_at` as "wanted since"?

When a PA row moves to `cards`, should the new card carry a
`wanted_since` timestamp (the original PA's `added_at`)? Two options:

- (A) **No carryover.** New `cards.added_at` = NOW(). The PA's
  history is just gone — the card's "added to collection" is the
  acquisition timestamp.
- (B) **Carry `added_at` as `wanted_since` on `cards`.** Add a
  nullable `cards.wanted_since timestamptz` column. UI can show
  "Wanted since {date}, acquired {date}" — emotionally satisfying
  for the user and useful analytics.

**Locked: (B).** Preserve PA's `added_at` as `wanted_since` on the
new card. Schema adds nullable `cards.wanted_since timestamptz`
column (see §2, migration 0005). `move-to-collection.js` INSERT…SELECT
copies the PA row's `added_at` into `wanted_since`. **Display:
CardModal sidebar only (not on tile).** Existing cards have
`wanted_since = NULL` (acquired before this feature).

### OQ-3 — Bucket toggle: persistent or per-session?

The Add Card form's bucket toggle:

- (A) **Default to My Collection on every visit.** Matches current
  default behavior; user explicitly picks PA when they want it.
- (B) **Remember last bucket via localStorage.** If the user just
  added a PA card, the next Add Card visit defaults to PA.
- (C) **Per-user preference** stored server-side (Cognito attribute
  or `users` row). Heaviest.

**Locked: (A).** Bucket toggle defaults to My Collection on every
Add Card visit. Explicit selection avoids surprise. Revisit if
multi-PA-in-a-row workflows emerge.

### OQ-4 — PA tile design: same as CardTile or different?

The PA tile should clearly read as "wanted, not owned". Two
directions:

- (A) **Same visual as CardTile.** Full image, identity, value
  block. Add a subtle "WANTED" or "PA" corner ribbon.
- (B) **Compact text-only tile.** No image, smaller footprint,
  emphasizes the PA-specific data (buy target, value gap).
- (C) **Same as CardTile but desaturated/dimmed.** Visually obvious
  "this isn't yours yet" without losing the image.

**Locked: (A) with corner ribbon.** Same `CardTile` component;
render **"WANTED"** label in top-right corner ribbon. Ribbon uses
slate styling (not gold) to match Editorial Dark hierarchy. Position
matches existing **TARGET HIT** badge pattern.

### OQ-5 — Refresh-portfolio behavior for PA rows

`refresh-portfolio.js` re-fetches valuations for stale cards. Should
PA rows refresh on the same schedule, less frequently, or only on
demand?

- (A) **Same schedule as cards.** PA rows refresh whenever the user
  hits the refresh endpoint. Doubles the CardHedger calls per user
  per refresh.
- (B) **Less frequently** (e.g., 72h staleness gate for PA vs 24h
  for cards). PA tiles can tolerate slightly stale prices since the
  user's not actively making sell decisions on them.
- (C) **Only on demand** (e.g., user clicks a "refresh" button on a
  PA tile). Zero background cost.

**Locked: (B).** PA refresh uses **72h staleness gate** vs 24h for
cards. Mirrors existing `refresh-portfolio.js` loop with a different
`INTERVAL` constant for the PA path.

### OQ-6 — Cross-bucket duplicate handling

User adds a cert to PA, then later adds the same cert to My Collection
(e.g., they acquired it outside the platform and forgot to use the
Move flow). What should happen?

- (A) **Independent buckets.** Both rows exist. The user can clean up
  by hard-deleting the PA row. Clear separation of concerns.
- (B) **Auto-move PA → cards on duplicate add.** The cards Add flow
  detects an existing PA for the same cert and offers "You already
  have this in your Potential Acquisitions — move it to your
  collection?". One-click resolution.
- (C) **Hard-block adding to cards while it's in PA.** Force the
  user to use the explicit Move flow.

**Locked: (B) auto-move with confirmation modal.** Match logic uses
`cardhedger_id` as primary identifier with `cert_number` as fallback
for cards outside CardHedger coverage. **Match query:**

```sql
SELECT id, ... FROM potential_acquisitions
WHERE user_id = $1
  AND (
    (cardhedger_id IS NOT NULL AND cardhedger_id = $2)
    OR
    ((cardhedger_id IS NULL OR $2 IS NULL) AND cert_number = $3)
  )
LIMIT 1;
```

When a match is found, the backend returns the special response shape:

```json
{
  "status": "pa_match_found",
  "paId": "<uuid>",
  "paDetails": { /* identity fields + addedAt */ }
}
```

Frontend shows confirmation modal: *"A card matching this one — [year
brand player grade] — is in your Potential Acquisitions (added
[relative date]). Move it to your collection?"* with **Confirm** /
**Cancel**. If confirmed, frontend calls
`/potential-acquisitions/{paId}/move` with `myCost` +
`sellTargetPrice` from the add form. If cancelled, no action.

Per **OQ-11** (below), valuation runs pre-INSERT with graceful
degradation. Per **OQ-12** (below), this match logic is **PA-only** —
does NOT apply to `add-card.js`'s INSERT (cards still permits multiple
rows with the same `cardhedger_id` when no PA row exists).

### OQ-7 — Future rename of `cards.target_price` → `cards.sell_target_price`

Per recon §6c, current design keeps the column name as `target_price`
(implicit-sell) since the bucket itself disambiguates. The UI label
becomes "Sell Target" in commit 5 of this rollout.

Future rename trigger: any time we need explicit symmetry in code
(e.g., a query that joins or unions across both target columns, or a
generic "show me both targets" UI).

**Locked: (B).** Rename `cards.target_price` →
`cards.sell_target_price` for schema-and-code symmetry with PA's
`buy_target_price`. **Ships as separate atomic commit 1b** between
migration and Lambdas (see §6 update). **NOT bundled into commit 1.**
Frontend variable renames (`targetPrice` → `sellTargetPrice`) ship
with **commit 3** since that commit already touches the cards data
layer. Visible UI label changes ("Target Price" → "Sell Target")
ship with **commit 5**.

### OQ-8 — PA image upload on add

Currently `add-card.js` accepts front + back image uploads. Should PA
add do the same?

- (A) **Skip image upload entirely.** PA cards aren't owned; the
  user doesn't have photos of them. The CardHedger image (already
  fetched in valuation) serves as the tile thumbnail.
- (B) **Allow optional image upload.** Some users may want to attach
  a reference (e.g., a screenshot of a listing they're tracking).

**Locked: (B).** PA add supports **optional front + back image
upload** (same UX as add-card — two DropZones, both optional). When
the user uploads nothing, the tile renders the front image from
`cardhedger_image_url` (fetched during `fetchValuation`); the back
falls back to a generic placeholder. Implementation: `add-pa.js`
accepts `hasFrontImage` / `hasBackImage` in the body and generates
pre-signed S3 upload URLs when requested. Frontend renders the
user-uploaded image when present, falls back to `cardhedger_image_url`
for front-only.

### OQ-9 — Empty state for the PA tab

First-time PA tab visit has zero rows. What does the page look like?

- (A) **Heavier empty state** with a description + CTA: *"Track
  cards you're looking to acquire. Set buy targets, watch market
  prices, move to your collection when you complete the trade."* +
  big "+ Add to Potential Acquisitions" button.
- (B) **Light empty state** matching My Collection's empty state
  treatment (small icon + one-liner + CTA).
- (C) **Re-use My Collection's empty state component** with copy
  override.

**Locked: (A).** Heavy empty state with educational copy. Copy:
*"Track cards you're looking to acquire. Set buy targets, watch
market prices, and move them to your collection when you complete
the trade."* Below copy: prominent **"+ Add to Potential
Acquisitions"** CTA. Slate styling consistent with Editorial Dark;
explanation paragraph appears only on first-visit (zero PA rows
state).

### OQ-10 — Visible "wanted since" / "added X days ago" indicator

Independent of OQ-2 (which is about preserving on move). Should the
PA tile show *how long* an item has been on the list?

- (A) **No timestamp.** Tiles show identity + value + target only.
- (B) **"Added 23 days ago" or "Added 2026-04-20"** on each tile.

**Locked: (B).** Show added date as a **small slate caption under
the buy target** on each PA tile. Format thresholds:

- **0 days** → "Added today"
- **1 day** → "Added yesterday"
- **2–29 days** → "Added N days ago"
- **30–89 days** → "Added N weeks ago"
- **90+ days** → "Added [absolute date in 'Mon DD, YYYY' format]"

### OQ-11 — `fetchValuation` ordering in `add-pa.js`

The plan originally ran `fetchValuation` *after* INSERT to avoid
CardHedger outages blocking adds. OQ-6's `cardhedger_id` matching
needs `cardhedger_id` at duplicate-check time, requiring valuation
*before* INSERT.

Three options:

- (A) **Move `fetchValuation` pre-INSERT entirely.** CardHedger
  outages block adds.
- (B) **Keep valuation post-INSERT.** No cross-cert duplicate
  detection at add time; refresh-time dedupe only.
- (C) **Pre-INSERT valuation with graceful degradation.** Try
  `fetchValuation`; on success, use `cardhedger_id` matching; on
  failure, fall back to cert-only matching and proceed.

**Locked: (C).** Wraps `fetchValuation` in try/catch. Success path
runs the full two-clause match query. Failure path runs degraded
cert-only match. Either path proceeds to INSERT. User experience is
identical to today on CardHedger outage; duplicate detection works
on normal days.

### OQ-12 — `cardhedger_id` matching scope: PA-only or also cards?

Same-card-different-cert duplicates exist in `cards` today
(**verified:** two `MEGA CHARIZARD X ex` rows share
`cardhedger_id = 1762727230420x227139533791821600`). Should the
match logic extend to `add-card.js`?

Three options:

- (A) **PA-only scope.** `cards` keeps its current cert-unique
  INSERT.
- (B) **Both buckets.** `add-card.js` rejects same `cardhedger_id`
  as 409.
- (C) **Both buckets with override.** `add-card.js` shows
  confirmation to add intentional duplicates.

**Locked: (A).** Multiple copies of the same card identity are
**valid collection behavior** (trade bait, accidental dupes, gift
cards). PA has clean "I want this; once I have one I'm done"
semantics that justify auto-move. Cards have ambiguous semantics
that don't. The two-Charizard reality in the DB is intentional, not
a bug.

---

*End of plan. All open questions locked 2026-05-13. Ready for §6
execution (commits 1 → 1b → 2 → 3 → 4 → 5).*
