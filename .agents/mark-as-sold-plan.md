# Mark as Sold — Implementation Plan

> Drafted 2026-05-12. Locked decisions in source prompt. This doc is the
> reference for execution; deviations from it require updating §8 first.
> Companion to [valuation-rebuild-plan.md](./valuation-rebuild-plan.md) —
> same shape, same conventions.

---

## 1. Overview

Today, "sold" is a terminal state of the **`consignments`** table, set
only by an admin via `update-consignment.js`. The user has no surface to
record a sale they handled themselves — a friend, a card show, a self-run
eBay listing, an auction house they used directly. The portfolio cannot
represent those exits; the realized P&L roll-up silently undercounts.

This rebuild adds a parallel "self-sold" path on the `cards` table:

1. **Reuses `cards.status`** — flips to `'sold'`, parallel to the existing
   `'traded'` value already consumed by `isTraded(card)`. No new column
   for the state machine itself.
2. **Adds discriminated-union venue columns** — `sold_price`, `sold_at`,
   `sold_venue_type` plus three nullable venue fields, exactly one of which
   is populated per `sold_venue_type`. A partial CHECK constraint enforces
   the invariant only when `status = 'sold'`, so existing rows
   (`status IS NULL`, `status = 'traded'`) are unaffected.
3. **Unifies `isSold(card)`** — the helper becomes a disjunction across
   the two paths (consignment-sold OR self-sold). Every downstream
   consumer (SOLD ribbon, realized P&L, sort comparator, sales-history
   suppression) keeps working through the unchanged helper signature.
4. **Adds the CardModal `MarkSoldBlock`** — a new "Mark as Sold" affordance
   parallel to the existing `ConsignBlock`, gated on "no open consignment"
   (no row, or only declined rows). Same inline-expand-into-form pattern as
   ConsignBlock; same dark form chrome.

The change is **additive at every layer**: schema (new nullable columns +
partial CHECK), backend (new Lambda + extra SELECT columns in three
reads), frontend (new component + a single helper rewrite). No existing
sold-state behavior changes for consignment-sold cards.

---

## 2. Schema changes

One additive migration. Backwards-compatible: every new column is
nullable; the CHECK is partial (only fires when `status = 'sold'`); the
FK to `card_shows` uses `ON DELETE SET NULL` so show cleanup never
cascades into card data.

`backend/db/migrations/0004_mark_as_sold.sql`:

```sql
-- 0004_mark_as_sold.sql
-- Adds self-sold venue columns to cards. Companion to mark-as-sold-plan.md.
-- Idempotent (IF NOT EXISTS on every column).
-- The status column already exists (NULL = held, 'traded' = trade exit);
-- we add 'sold' as the third terminal value. No enum/CHECK on status itself
-- — kept as free text to match the existing pattern.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS sold_price         numeric(10,2),
  ADD COLUMN IF NOT EXISTS sold_at            date,
  ADD COLUMN IF NOT EXISTS sold_venue_type    text,
  ADD COLUMN IF NOT EXISTS sold_show_id       uuid REFERENCES card_shows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_auction_house text,
  ADD COLUMN IF NOT EXISTS sold_other_text    text;

-- Partial CHECK: only enforced when status = 'sold'. Existing rows
-- (status IS NULL, status = 'traded') are exempt by design — they have
-- no venue at all. The constraint encodes the discriminated-union
-- invariant: sold_venue_type matches exactly one populated venue column,
-- AND the required scalar fields (sold_price, sold_at) are non-null.
ALTER TABLE cards
  ADD CONSTRAINT cards_sold_venue_consistency CHECK (
    status IS DISTINCT FROM 'sold'
    OR (
      sold_price IS NOT NULL
      AND sold_at IS NOT NULL
      AND sold_venue_type IN ('show', 'auction', 'other')
      AND (
        (sold_venue_type = 'show'
          AND sold_show_id        IS NOT NULL
          AND sold_auction_house  IS NULL
          AND sold_other_text     IS NULL)
        OR (sold_venue_type = 'auction'
          AND sold_show_id        IS NULL
          AND sold_auction_house  IS NOT NULL
          AND sold_other_text     IS NULL)
        OR (sold_venue_type = 'other'
          AND sold_show_id        IS NULL
          AND sold_auction_house  IS NULL
          AND sold_other_text     IS NOT NULL)
      )
    )
  );

-- Partial index on sold_at for realized-P&L queries that need to filter
-- self-sold cards in a date range (annual reports, "what did I sell this
-- year"). Predicate matches the CHECK constraint's "sold" branch.
CREATE INDEX IF NOT EXISTS idx_cards_sold_at
  ON cards (user_id, sold_at)
  WHERE status = 'sold';
```

**Why these column types:**

| Column | Type | Rationale |
|---|---|---|
| `sold_price` | `numeric(10,2)` | Matches `consignments.sold_price`, `my_cost`, etc. Currency to 2 decimals, max ~$99M. |
| `sold_at` | `date` | Day-resolution is enough; time-of-day adds no analytical value for a personal portfolio. Same shape as `card_shows.show_date`. |
| `sold_venue_type` | `text` | Discriminator. Constrained via CHECK to `{show, auction, other}` rather than a Postgres enum so adding a fourth type later is a no-migration change. |
| `sold_show_id` | `uuid REFERENCES card_shows(id) ON DELETE SET NULL` | FK preserves the show↔sale relationship for analytics. SET NULL (not RESTRICT) so show cleanup doesn't cascade — the venue downgrades to "show name unavailable" rather than blocking the delete. See OQ-1 for the alternative. |
| `sold_auction_house` | `text` | Free-text with a UI-suggested list (eBay Auction, PWCC, Heritage, Goldin, Fanatics Collect, Sotheby's, Memory Lane). Not a hard enum per locked decisions — locks in flexibility for the user to enter "Robert Edward Auctions" or "Lelands" without a migration. |
| `sold_other_text` | `text` | "Private sale", "dealer at flea market", "friend", "Instagram", etc. Fully freeform. |

**Apply via Query Editor** (per CONTEXT.md §11). Verify with:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'cards'
  AND column_name LIKE 'sold_%'
ORDER BY column_name;

-- And confirm the constraint:
SELECT conname FROM pg_constraint
WHERE conrelid = 'cards'::regclass
  AND conname = 'cards_sold_venue_consistency';
```

Expected: 6 rows from the first query, 1 row from the second.

---

## 3. Backend changes (file-by-file)

### `backend/functions/cards/mark-sold.js` — NEW

Collector PATCH `/cards/{id}/mark-sold`. Validates ownership, validates
venue consistency, validates no open consignment, writes the sold state
in a single UPDATE.

```js
// PATCH /cards/{id}/mark-sold — collector records a self-sold card.
// Distinct from the consignment flow: a self-sold card never had its
// sale mediated by the platform, so it gets no consignment row, no
// fee, no sellers_net. Just price, date, venue.
//
// Idempotency is NOT enforced server-side: re-submitting with new venue
// data overwrites the prior values. This matches the locked decision
// that mark-as-sold is reversible from the UI (see OQ-3).
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidPrice, sanitize } = require("../_validate");

const VALID_VENUE_TYPES = new Set(["show", "auction", "other"]);
const MAX_AUCTION_HOUSE = 120;
const MAX_OTHER_TEXT    = 240;

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { soldPrice, soldAt, venueType, showId, auctionHouse, otherText } = body;

  // ── Scalar field validation ────────────────────────────────────────
  if (!isValidPrice(soldPrice)) {
    return json(400, { error: "soldPrice must be a non-negative number under 10,000,000" });
  }
  // Accept YYYY-MM-DD; reject anything else (no time component).
  if (!soldAt || !/^\d{4}-\d{2}-\d{2}$/.test(soldAt)) {
    return json(400, { error: "soldAt must be a YYYY-MM-DD date" });
  }
  if (!VALID_VENUE_TYPES.has(venueType)) {
    return json(400, { error: "venueType must be 'show', 'auction', or 'other'" });
  }

  // ── Venue-discriminator validation ─────────────────────────────────
  // Exactly one of showId / auctionHouse / otherText must be populated,
  // and it has to match venueType. The DB CHECK is the source of truth;
  // this is just a friendlier 400 than the constraint-violation 500.
  let showIdValue = null, auctionHouseValue = null, otherTextValue = null;
  if (venueType === "show") {
    if (!isValidId(showId)) return json(400, { error: "showId required for venueType='show'" });
    showIdValue = showId;
  } else if (venueType === "auction") {
    const ah = sanitize(auctionHouse, MAX_AUCTION_HOUSE);
    if (!ah) return json(400, { error: "auctionHouse required for venueType='auction'" });
    auctionHouseValue = ah;
  } else {
    const ot = sanitize(otherText, MAX_OTHER_TEXT);
    if (!ot) return json(400, { error: "otherText required for venueType='other'" });
    otherTextValue = ot;
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email,
    claims.given_name ?? null, claims.family_name ?? null);

  // ── Ownership + state preconditions ────────────────────────────────
  // Single query: card must belong to user, and the most-recent
  // consignment (if any) must NOT be in an open state. Mirrors the
  // LATERAL pattern from get-card.js so the constraint check is
  // consistent with what the UI reads.
  const guard = await db.query(
    `SELECT c.id, c.status AS card_status, cn.status AS consignment_status
     FROM cards c
     LEFT JOIN LATERAL (
       SELECT status FROM consignments
       WHERE card_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) cn ON TRUE
     WHERE c.id = $1 AND c.user_id = $2`,
    [cardId, userId],
  );
  if (guard.rowCount === 0) return json(404, { error: "Card not found" });
  const row = guard.rows[0];

  if (row.card_status === "traded") {
    return json(409, { error: "Card has been traded away; cannot mark as sold" });
  }
  // Open consignment states block mark-as-sold. Declined is allowed
  // (collector and admin agreed not to sell via platform; user is now
  // selling on their own). Sold is also rejected because the card is
  // already sold via the consignment path.
  const OPEN_CONSIGNMENT_STATES = new Set(["pending", "in_review", "listed"]);
  if (row.consignment_status === "sold") {
    return json(409, { error: "Card already sold via consignment" });
  }
  if (OPEN_CONSIGNMENT_STATES.has(row.consignment_status)) {
    return json(409, { error: "Card has an open consignment; cancel or decline it first" });
  }

  // ── Write ──────────────────────────────────────────────────────────
  // The CHECK constraint is defense-in-depth; the validation above
  // should already guarantee a passing row.
  await db.query(
    `UPDATE cards SET
       status             = 'sold',
       sold_price         = $1,
       sold_at            = $2::date,
       sold_venue_type    = $3,
       sold_show_id       = $4,
       sold_auction_house = $5,
       sold_other_text    = $6
     WHERE id = $7 AND user_id = $8`,
    [parseFloat(soldPrice), soldAt, venueType,
     showIdValue, auctionHouseValue, otherTextValue,
     cardId, userId],
  );

  return json(200, {
    id: cardId,
    status: "sold",
    soldPrice: parseFloat(soldPrice),
    soldAt,
    soldVenueType: venueType,
    soldShowId:       showIdValue,
    soldAuctionHouse: auctionHouseValue,
    soldOtherText:    otherTextValue,
  });
};
```

### `backend/functions/cards/get-cards.js` — return new fields

Extend the existing LATERAL+LEFT JOIN with a second LEFT JOIN to
`card_shows` keyed on `sold_show_id`, so the response carries the show's
name + date without a second round-trip:

```sql
SELECT c.id, ..., c.status, c.added_at,
       c.sold_price, c.sold_at, c.sold_venue_type,
       c.sold_auction_house, c.sold_other_text,
       cs.id   AS sold_show_id,
       cs.name AS sold_show_name,
       cs.show_date AS sold_show_date,
       cn.status     AS consignment_status,
       ...
FROM cards c
LEFT JOIN LATERAL (...) cn ON TRUE
LEFT JOIN consignment_blocks cb ON ...
LEFT JOIN card_shows cs ON cs.id = c.sold_show_id
WHERE c.user_id = $1
ORDER BY c.added_at DESC
```

Response object gains (camelCase, same convention as the existing fields):

```js
{
  // ... existing fields ...
  soldPrice:        row.sold_price ? parseFloat(row.sold_price) : null,
  soldAt:           row.sold_at instanceof Date
                      ? row.sold_at.toISOString().slice(0,10)
                      : (row.sold_at ?? null),
  soldVenueType:    row.sold_venue_type ?? null,
  soldShowId:       row.sold_show_id   ?? null,
  soldShowName:     row.sold_show_name ?? null,
  soldShowDate:     row.sold_show_date instanceof Date
                      ? row.sold_show_date.toISOString().slice(0,10)
                      : (row.sold_show_date ?? null),
  soldAuctionHouse: row.sold_auction_house ?? null,
  soldOtherText:    row.sold_other_text    ?? null,
}
```

### `backend/functions/cards/get-card.js` — return new fields

Same change as `get-cards.js`. Single-row response gains the same eight
new fields. Add the same `LEFT JOIN card_shows cs ON cs.id = c.sold_show_id`.

### `backend/functions/admin/get-card.js` — return new fields

Same SELECT + LEFT JOIN additions. **Drift note:** this file currently
lags `cards/get-card.js` on the valuation-rebuild fields (estimate_*,
variant) — already inconsistent. Spec for this rebuild: bring it back
into sync on the sold_* fields. The estimate_* drift is out of scope
here, but flag it in OQ-4.

### `backend/functions/portfolio/get-value.js` — realized rollup awareness

The dashboard fast-path computes `total_value` filtered on
`c.status IS NULL AND (cn.status IS NULL OR cn.status NOT IN ('sold'))`.
After mark-as-sold, `c.status = 'sold'` already falls outside this filter
(NULL test), so held-value is correct.

But the same endpoint computes realized totals — those need a second
disjunction: realized = `consignment-sold` ∨ `self-sold`. Spec:

```sql
SUM(COALESCE(c.sold_price, cn.sellers_net, cn.sold_price)) FILTER (
  WHERE c.status = 'sold' OR cn.status = 'sold'
) AS realized_value,

SUM(c.my_cost) FILTER (
  WHERE c.status = 'sold' OR cn.status = 'sold'
) AS invested_sold,
```

Held filter inverts to: `c.status IS NULL AND (cn.status IS NULL OR cn.status <> 'sold')`.
The `traded` exclusion (`c.status IS NULL`) already covers itself.

### `backend/functions/admin/list-consignments.js` — no required change

This endpoint reads `consignments` joined to `cards`; self-sold cards
without a consignment row don't appear here, which is correct (admins
don't manage self-sold cards). The endpoint stays untouched.

### `infrastructure/lib/api-stack.ts` — register the new Lambda

Mirror the `MarkAttending` / `create-consignment` patterns. Three
additions:

1. **Lambda definition** (alongside `createConsignmentFn` ~L444):
   ```ts
   const markSoldFn = new NodejsFunction(this, "MarkSold", {
     ...sharedNodejsProps,
     functionName: "scp-mark-sold",
     entry: path.join(functionsDir, "cards/mark-sold.js"),
   });
   ```

2. **DB grants array** (L543 — the loop that grants secret-read to every
   function). Append `markSoldFn` to the spread list.

3. **Route registration** (alongside the `/shows/{id}/attending` route
   block at L810):
   ```ts
   httpApi.addRoutes({
     path: "/cards/{id}/mark-sold",
     methods: [apigwv2.HttpMethod.PATCH],
     integration: new apigwv2integrations.HttpLambdaIntegration("MarkSold", markSoldFn),
     ...authRoute,
   });
   ```

PATCH (not POST) for consistency with the existing `PATCH /cards/{id}/price`.

---

## 4. Frontend changes (file-by-file)

### `frontend/src/services/api.js` — new API client function

Append after `createConsignment`:

```js
// PATCH /cards/{id}/mark-sold — record a self-sold card.
// payload shape:
//   { soldPrice, soldAt, venueType: 'show'|'auction'|'other',
//     showId?, auctionHouse?, otherText? }
// Exactly one of showId / auctionHouse / otherText is populated,
// matching venueType. Returns the updated sold-state fields.
export async function markCardSold(cardId, payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${cardId}/mark-sold`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}
```

### `frontend/src/components/MarkSoldBlock.jsx` — NEW

Mirror the `ConsignBlock` structure: collapsed CTA button → inline form
on click → submit → success state (parent re-renders into the SOLD pill).

Skeleton (full implementation in commit 4):

```jsx
import { useState } from "react";
import { markCardSold } from "../services/api.js";

// "Mark as Sold" affordance for self-sold cards. Three flows:
//   already sold (any path) → not rendered (parent suppresses).
//   collapsed → "Mark as Sold" button.
//   form → venue-type selector + dynamic second input + price + date.
//
// Visibility (locked):
//   - role === 'admin' → null (admins manage via the consignments queue)
//   - cardStatus === 'sold' → null (already sold via this path)
//   - cardStatus === 'traded' → null (gone via trade)
//   - consignmentStatus in {pending, in_review, listed, sold} → null
//   - consignmentStatus === 'declined' OR null → render
export default function MarkSoldBlock({
  cardId,
  role,
  cardStatus,
  consignmentStatus,
  userShows,           // [{ id, name, date }] — past shows the user attended
  onMarkedSold,        // (updatedFields) => void; parent patches local state
}) {
  const [stage, setStage]           = useState("collapsed");  // collapsed | form
  const [venueType, setVenueType]   = useState("show");
  const [showId, setShowId]         = useState("");
  const [auctionHouse, setAuctionHouse] = useState("");
  const [otherText, setOtherText]   = useState("");
  const [price, setPrice]           = useState("");
  const [soldAt, setSoldAt]         = useState(() => new Date().toISOString().slice(0,10));
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState(null);

  if (role === "admin") return null;
  if (cardStatus === "sold" || cardStatus === "traded") return null;
  if (consignmentStatus && consignmentStatus !== "declined") return null;
  // ... handleSubmit, JSX form, etc.
}

// Auction suggested values — datalist source. Custom entries allowed.
const AUCTION_SUGGESTIONS = [
  "eBay Auction", "PWCC", "Heritage", "Goldin",
  "Fanatics Collect", "Sotheby's", "Memory Lane",
];
```

The form's second input swaps based on `venueType`:

- **show** — `<select>` populated from `userShows` (filtered to
  `date <= today`, sorted by `date DESC`).
- **auction** — `<input list="auction-house-suggestions">` + `<datalist>`
  with the 7 suggestions above. Custom entries pass through unchanged.
- **other** — `<input type="text">` freeform.

Always-rendered fields: `soldPrice` (number, required) and `soldAt`
(date, defaults to today, required). For show sales: see OQ-2 — does
`soldAt` auto-fill from the selected show's date?

Style block: copy the structure of `ConsignBlock`'s `st` object — same
form chrome (amber border, dark inputs, gold CTA button). The intent is
visual parity so the two affordances feel like siblings.

### `frontend/src/components/CardModal.jsx` — wire in MarkSoldBlock + sold-state display

**Three changes.**

**1. Render `MarkSoldBlock` parallel to the held-card `ConsignBlock`.**

The held-card `ConsignBlock` sits at `CardModal.jsx:361-373`. Add
`MarkSoldBlock` immediately after, with the same `!sold && hydrated &&
!adminConsignment` gate:

```jsx
{!sold && hydrated && !adminConsignment && (
  <MarkSoldBlock
    cardId={card.id}
    role={role}
    cardStatus={card.status}
    consignmentStatus={card.consignmentStatus ?? null}
    userShows={userShows}  // see below
    onMarkedSold={(fields) => onCardUpdate?.(card.id, fields)}
  />
)}
```

`userShows` needs to be fetched. Options:
- (A) CardModal fetches its own list via `getShows()` + filter on
  `attending && date <= today`, lazily (only when MarkSoldBlock's form
  opens). Self-contained but adds a network call per modal open.
- (B) `PortfolioPage` prefetches once and passes down via prop. Faster
  on subsequent modal opens but couples the pages.

Recommendation: (A) with the call deferred until form-expand, so most
modal opens don't pay the cost. See OQ-5.

**2. Update `isSold` import + the `sold` memo (CardModal.jsx:158-172).**

The memo currently inlines the legacy isSold test:
```js
const isSoldCard =
  card.consignmentStatus === "sold" && card.consignmentSoldPrice != null;
```
Replace with the imported helper:
```js
import { effectiveValue, confidenceLabel, isSold } from "../utils/portfolio.js";
// ...
const sold = isSold(card);
const displayValue = sold
  ? (card.soldPrice ?? card.sellersNet ?? card.consignmentSoldPrice)
  : effectiveValue(card);
```
The displayValue precedence order: **self-sold price** (no fees on
self-sold), **sellers net** (consignment with fee schema), **gross
consignment sold price** (legacy pre-fee).

**3. Render self-sold venue + price in the sold-state block.**

Today the sold-state block at CardModal.jsx:315-327 renders `ConsignBlock`
in read-only mode (StatusPill). For self-sold cards, render a new
`SelfSoldBlock` component instead:

```jsx
{sold && hydrated && !adminConsignment && (
  card.status === "sold"
    ? <SelfSoldBlock
        soldPrice={card.soldPrice}
        soldAt={card.soldAt}
        venueType={card.soldVenueType}
        showName={card.soldShowName}
        showDate={card.soldShowDate}
        auctionHouse={card.soldAuctionHouse}
        otherText={card.soldOtherText}
      />
    : <ConsignBlock ... />  // existing path
)}
```

`SelfSoldBlock` is a small read-only block inside CardModal.jsx. Visual
treatment: green "Sold" pill (matches consignment's sold pill green —
`#10b981` family from `STATUS_VARIANTS.sold` in ConsignBlock.jsx), then a
single block underneath with three rows: Sold Price, Sold On, Sold At
(venue rendered per type — "[Show Name] on [Show Date]" /
"[Auction House]" / "[Other text]").

Suppresses the rendered SOLD ribbon corner-flag's existing styling
(`PortfolioPage.jsx:1662` uses `cornerRibbonSold`); no change needed
there, the ribbon is keyed off `isSold(card)` which now covers both paths.

### `frontend/src/utils/portfolio.js` — helper unification

See §5 for the full before/after on this file. The main rewrite is
`isSold` (disjunction across the two paths) and `effectiveValue`'s sold
branch (self-sold price first).

### `frontend/src/pages/PortfolioPage.jsx` — touchless via unified helpers

PortfolioPage reads sold-state exclusively through `isSold(card)`:
- Line 1048: `const sold = isSold(card);` (list-view row)
- Line 1580: `const sold = isSold(card);` (grid-view tile)
- Line 1728: `const sold = isSold(card);` (per-card cost block)
- Line 1816: `const sold = isSold(card);` (price/value cell)

All these continue to work unchanged because `isSold` is rewritten in
place. The SOLD ribbon, the Collection History grouping, the realized-vs-
unrealized P&L chips, the sort comparator — every read goes through the
helper.

**One spot needs an extra branch:** the Collection History summary strip
at PortfolioPage.jsx:1416-1431 computes realized P&L per sold card:
```js
const realized = c.sellersNet ?? c.consignmentSoldPrice;
```
Extend to prefer the self-sold price:
```js
const realized = c.soldPrice ?? c.sellersNet ?? c.consignmentSoldPrice;
```
Same precedence as the CardModal displayValue.

---

## 5. Helper unification

The single source of truth for sold-state is `frontend/src/utils/portfolio.js`.
Every other consumer reads through these helpers; this section is the
authoritative before/after.

### `isSold(card)` — disjunction across paths

**Before** (portfolio.js:8-10):
```js
export function isSold(card) {
  return card?.consignmentStatus === "sold" && card?.consignmentSoldPrice != null;
}
```

**After:**
```js
// A card is "sold" if it has exited the portfolio via either:
//   - consignment sale: an admin closed a consignments row with a price
//   - self-sold: the user recorded the sale via Mark as Sold
// Self-sold cards live on cards.status='sold' with sold_price set;
// consignment-sold cards live on the joined consignments row.
export function isSold(card) {
  if (!card) return false;
  if (card.status === "sold" && card.soldPrice != null) return true;
  if (card.consignmentStatus === "sold" && card.consignmentSoldPrice != null) return true;
  return false;
}
```

### `effectiveValue(card)` — self-sold price short-circuit

**Before** (portfolio.js:35-39):
```js
export function effectiveValue(card) {
  if (!card) return null;
  if (isSold(card)) return card.sellersNet ?? card.consignmentSoldPrice;
  return card.manualPrice ?? card.estimatePrice ?? card.estimatedValue ?? null;
}
```

**After:**
```js
export function effectiveValue(card) {
  if (!card) return null;
  if (isSold(card)) {
    // Self-sold: no platform fee, no sellers_net concept. The price the
    // user entered IS the realized number.
    if (card.status === "sold" && card.soldPrice != null) return card.soldPrice;
    // Consignment-sold: prefer sellers_net (post-fee), fall back to gross
    // for legacy rows without fee data.
    return card.sellersNet ?? card.consignmentSoldPrice;
  }
  return card.manualPrice ?? card.estimatePrice ?? card.estimatedValue ?? null;
}
```

### `summarizePortfolio(cards)` — realized branch picks up self-sold

**Before** (portfolio.js:84-91):
```js
if (isSold(c)) {
  out.soldCount += 1;
  const realized = c.sellersNet ?? c.consignmentSoldPrice;
  out.realizedValue += realized;
  if (cost != null) {
    out.investedSold += cost;
    out.realizedPnl  += realized - cost;
    out.hasSoldCost = true;
  }
}
```

**After:**
```js
if (isSold(c)) {
  out.soldCount += 1;
  // Same precedence as effectiveValue: self-sold price first, then
  // consignment sellers_net, then legacy gross consignment price.
  const realized = (c.status === "sold" && c.soldPrice != null)
    ? c.soldPrice
    : (c.sellersNet ?? c.consignmentSoldPrice);
  out.realizedValue += realized;
  if (cost != null) {
    out.investedSold += cost;
    out.realizedPnl  += realized - cost;
    out.hasSoldCost = true;
  }
}
```

### Other reads — touched indirectly

| Consumer | File:line | Change |
|---|---|---|
| `CardModal` sold detect | CardModal.jsx:158-172 | Import `isSold` and use it (instead of inlining the legacy test). |
| `CardModal` displayValue | CardModal.jsx:168-170 | Prefer `card.soldPrice` before `sellersNet`. |
| `CardModal` `CostAndPnl` | CardModal.jsx:625-644 | Same inline `isSold` test → swap for imported helper. |
| `PortfolioPage` grid tile | PortfolioPage.jsx:1580 | Already uses `isSold(card)` — no change. |
| `PortfolioPage` list row | PortfolioPage.jsx:1048 | Already uses `isSold(card)` — no change. |
| `PortfolioPage` price cell | PortfolioPage.jsx:1817 | Extends the sold-display: `const display = sold ? (card.soldPrice ?? card.consignmentSoldPrice) : effectiveValue(card);` |
| `PortfolioPage` Collection History stats | PortfolioPage.jsx:1416-1431 | Extend realized = `c.soldPrice ?? c.sellersNet ?? c.consignmentSoldPrice`. |
| `backend/functions/portfolio/get-value.js` | (no `effectiveValue` in JS — pure SQL) | See §3: extend FILTER predicates to OR `c.status='sold'`. |
| `backend/functions/portfolio/pricing.js` | n/a | **Does NOT export an `effectiveValue` helper** — confirmed via grep. The locked-decision phrasing "Update isSold reads in pricing.js's effectiveValue (if it exists there)" is a no-op for backend. Frontend `portfolio.js` is the only `effectiveValue` site. |

---

## 6. Commit sequence

Same ordering principle as the valuation-rebuild plan: schema first,
backend next, frontend last. Each commit independently verifiable.
Amplify auto-deploys frontend on push to `master`; backend needs
explicit `cdk deploy`.

| # | Commit | Branch | Auto-deploys? | Verification |
|---|---|---|---|---|
| **1** | `db: 0004 add mark-as-sold columns + partial CHECK` | master | No (SQL only — manual apply via Query Editor) | Verify queries from §2 return 6 columns + 1 constraint. Run a quick `UPDATE cards SET status='sold' WHERE id='<test>'` on a throwaway row to confirm CHECK fires (should fail until venue fields populated). Rollback the test row. |
| **2** | `cards: add mark-sold Lambda + register in api-stack` | master | No (needs `cdk deploy`) | `cdk diff` shows MarkSold function + 1 new route. Deploy; test invoke with curl/Postman; expect 200 on a valid payload, appropriate 4xx on each validation branch. |
| **2a** | `consignments: reject create when card already self-sold` | master | No (needs `cdk deploy`) | POST `/consignments` for a card whose `cards.status='sold'` returns 409 with a clear error. Existing consignment creates on held cards continue to work. See OQ-7. |
| **3** | `cards: extend get-cards/get-card/admin sold_* fields + join card_shows` | master | No (needs `cdk deploy`) | After deploy, hit `/cards` and confirm response includes the 8 new sold_* fields (all null for non-sold cards). Self-sold card from commit 2 shows populated venue fields. |
| **4** | `portfolio: extend get-value realized rollup to OR self-sold path` | master | No (needs `cdk deploy`) | After deploy, mark a card sold via the API; hit `/portfolio/value`; confirm realized total includes the new sale. |
| **5** | `frontend: unify isSold helper + extend effectiveValue + summarizePortfolio` | master | Yes (Amplify) | Open a card that's sold via consignment — SOLD ribbon still renders, realized P&L still correct. Helper changes are pure-additive at the type level (existing cards have `status=null`, `soldPrice=null` — disjunction collapses to the legacy branch). |
| **6** | `frontend: add MarkSoldBlock component + wire into CardModal` | master | Yes (Amplify) | Open a held card without consignment → see "Mark as Sold" button below "Consign This Card". Submit the form for each of the 3 venue types; confirm card flips to sold state and the SelfSoldBlock renders the venue correctly. Open a card with a pending consignment → MarkSoldBlock is suppressed. |
| **7** | `frontend: SelfSoldBlock display + PortfolioPage realized rollup extension` | master | Yes (Amplify) | Self-sold card in Collection History grid shows SOLD ribbon, sale venue + price; Collection History summary strip counts the sale; pie chart / dashboard rollup unchanged. |

**Why this order:**

- **Schema first (1):** writes from commit 2 would fail on missing
  columns; the CHECK constraint protects every subsequent write.
- **Backend Lambda (2):** the new endpoint exists but no UI calls it
  yet. Test it in isolation via curl.
- **Defensive guard (2a):** the OQ-7 cross-path-conflict guard touches
  `consignments/create.js` — a separate, already-deployed endpoint — so
  it's a different concern from commit 2's new endpoint. Splitting it
  off keeps each commit independently revertable.
- **Reads (3, 4):** populate the response shape the frontend expects.
  Frontend doesn't read the new fields yet, so this is purely additive.
- **Helper unification (5):** rewrites are pure-additive at runtime —
  no card today has `status='sold'`, so the new branch never fires until
  commit 6's UI lands. This guarantees commit 5 can't break consignment-
  sold rendering.
- **MarkSoldBlock + display (6, 7):** the visible UI. Split between the
  write affordance (6) and the read affordance (7) so a failed form
  submit isn't entangled with a broken sold-state render. If the form
  works but the display is broken, the user's data is still safe;
  refresh and the consignment path still renders for prior sales.

**Steps 1–7 are committable + deployable over the course of a single
session.** None of them have a long-running data step (unlike valuation-
rebuild's backfill); the change is purely forward-looking for new sales.

---

## 7. Rollback story

| Commit | Rollback | Side effects |
|---|---|---|
| **1 — Schema** | `ALTER TABLE cards DROP CONSTRAINT cards_sold_venue_consistency; ALTER TABLE cards DROP COLUMN sold_price, sold_at, sold_venue_type, sold_show_id, sold_auction_house, sold_other_text; DROP INDEX idx_cards_sold_at;` Only needed if a column causes query plan issues — leaving inert nullable columns is fine, and the CHECK constraint with the partial guard imposes zero cost on non-sold rows. | None on existing data (no self-sold rows yet). |
| **2 — mark-sold Lambda + route** | `git revert <sha>` + `cdk deploy`. Endpoint returns 404 (route removed). The Lambda + IAM grant go away. | Any in-flight POSTs fail. No data state to clean up — the endpoint hadn't been wired to a UI yet. |
| **2a — Consignment-create guard** | `git revert <sha>` + `cdk deploy`. The `consignments/create.js` endpoint reverts to accepting creates regardless of `cards.status`. | None — the guard is a precondition check, not a data mutation. Any consignments accepted while the guard was live remain valid (they preceded the user self-selling). |
| **3 — get-cards/get-card SELECTs** | `git revert <sha>` + `cdk deploy`. Response shape drops the 8 sold_* fields. Frontend reads `card.soldPrice` etc. as undefined — `isSold` falls back to the legacy branch, SelfSoldBlock can't render. | Any card already self-sold becomes invisible-as-sold to the UI (would render as held). Data still safe in DB; restore by re-deploying. |
| **4 — get-value realized rollup** | `git revert <sha>` + `cdk deploy`. Dashboard total_value/realized_value briefly excludes self-sold cards from realized rollup. | Dashboard totals undercount realized until re-deployed. |
| **5 — Helper unification** | `git revert <sha>`, push, Amplify deploys in ~3 min. isSold falls back to the consignment-only definition; self-sold cards stop being treated as sold by the UI (would render as held). | Same as commit 3 rollback — data safe, display regresses. |
| **6 — MarkSoldBlock + CardModal wire** | `git revert <sha>`, push. The "Mark as Sold" button disappears; users can't create new self-sold records, but existing ones still display via commit 7's SelfSoldBlock (if commit 7 is still deployed). | New write path unavailable. Reads continue. |
| **7 — SelfSoldBlock + PortfolioPage** | `git revert <sha>`, push. Self-sold cards render their SOLD ribbon (via isSold) but the detail view shows nothing for venue/price. | Self-sold cards visually degrade but stay marked sold. |

**General principle:** every commit is `git revert + push + cdk deploy`
(where applicable). The migration is the only commit that touches data;
its rollback is a column drop, which preserves no data on rollback — but
no data exists in those columns until commit 2's endpoint is called by
commit 6's UI, so rollback before that point is lossless.

**Hardest rollback to reason about:** commits 5–7 are entangled by the
helper. If commit 6 ships and a user marks a card sold, then commit 5 is
reverted, the card's `cards.status='sold'` row remains in DB but the
frontend stops recognizing it as sold (isSold falls back to the
consignment-only branch). The card would re-appear in "held" — visible
but the user would think "wait, I sold this." Mitigation: don't revert
commit 5 in isolation; revert in reverse order (7 → 6 → 5) or write a
SQL script to flip `cards.status` back to `NULL` for any affected rows.

---

## 8. Open questions

These need a design call before §6's commit 1 ships. Most have a
recommendation; one or two genuinely need human judgment.

### OQ-1 — `card_shows` FK delete behavior

Schema spec uses `ON DELETE SET NULL` on `sold_show_id`. Alternatives:

- (A) `SET NULL` — show cleanup is non-blocking; the venue degrades to
  "show name unavailable" on the card's sale display. **Spec'd.**
- (B) `RESTRICT` — show cleanup is blocked until every sale referencing
  it is reassigned. Preserves analytical integrity but couples ops to
  data history.
- (C) Snapshot show name + date into the sale row at write-time, so the
  FK is decorative and deletion is harmless. Costs ~80 bytes per
  self-sold show-sale.

**Recommendation: (A).** Show cleanup is rare (only happens when
`import-shows.js` re-imports a stale TCDB id that's now reassigned), and
the cost of an occasional "show name unavailable" is lower than the cost
of either blocking deletes (B) or denormalizing every sale (C).
Revisit if a sale ever degrades visibly — then snapshot in a follow-up.

### OQ-2 — `sold_at` default for show sales

The form defaults `sold_at` to today. For show sales, should it auto-fill
from the selected show's `show_date` instead?

- (A) Always today; user manually changes if the show was earlier.
- (B) For `venueType='show'`, auto-fill `sold_at = show.show_date` when
  the user picks a show; let them edit after.
- (C) For `venueType='show'`, lock `sold_at` to the show's date.

**Recommendation: (B).** Auto-fill matches the user's intent ("I sold
this at the National on Aug 3") in 95% of cases; the editable input
covers the 5% case where the sale closed the day after the show.

### OQ-3 — Reversibility / "undo mark as sold"

The form is one-way today: once a card is marked sold, the user can't
revert it from the UI without admin intervention. Per the consignment
pattern, sold-state is locked (`ConsignBlock.jsx:14-21` comments confirm
this is by design). Self-sold cards inherit the same lock:

- (A) Match consignment behavior — sold is terminal, no UI undo.
- (B) Add a "Revert to held" button on SelfSoldBlock for self-sold
  cards. (Consignment cards still admin-only, since the admin is the
  source of truth for those.)

**Recommendation: (B), but defer to a follow-up commit.** Users
will mis-click; the self-sold path doesn't involve a third party who
needs to be informed, so reversibility is safe. Ship (A) for v1 to keep
scope tight, log it as a known follow-up. **Trigger for (B):** the first
user-reported accidental mark-as-sold, OR more than one such report
observed in support channels.

### OQ-4 — Admin `get-card.js` already drifted from user `get-card.js`

`backend/functions/admin/get-card.js` is missing the valuation-rebuild
fields (estimate_*, variant) that `cards/get-card.js` has. Spec for
this rebuild brings it back into sync on sold_* fields. **Should we
also fix the existing drift?**

- (A) Yes — bring the file fully into sync as part of commit 3.
- (B) No — out of scope; flag as a separate follow-up.

**Recommendation: (A).** It's a 15-line additive change (mirror the
SELECT + LEFT JOIN + response shape from `cards/get-card.js`), and an
admin viewing a self-sold consigned card with a variant would benefit.
Adds zero risk because the admin endpoint isn't load-bearing.

### OQ-5 — `userShows` fetch strategy in CardModal

MarkSoldBlock needs a list of past shows the user attended. Options:

- (A) **Lazy fetch on form expand.** First click on "Mark as Sold"
  triggers `getShows()`; filter client-side to attended + past. Adds one
  network call but only when the user is actually selling at a show.
- (B) **Prefetch from PortfolioPage.** PortfolioPage calls `getShows()`
  once on mount, passes the filtered list to CardModal as a prop. Faster
  modal-open, but ties PortfolioPage to data it doesn't use itself.
- (C) **New focused endpoint.** `GET /shows/attended-past` returns just
  the slim list. New Lambda, new route, but the payload is tiny.

**Recommendation: (A).** Most modal opens are for non-sold cards; most
held cards never get marked sold; most sold cards aren't show sales.
Paying the network cost only at form-expand is the right amortization.

### OQ-6 — Helper unification ships before write path (commits 5 vs 6)

Spec ships commit 5 (helper rewrite) before commit 6 (MarkSoldBlock UI).
**Is the helper change safe to ship without a UI that uses the new
branch?**

The new `isSold` branch fires only when `card.status === "sold" &&
card.soldPrice != null`. No card today has those columns populated
(commit 1 just adds them; commit 6 is the only writer). So the new
disjunction is dead code at runtime until commit 6 ships. Commit 5
is a no-op for all existing cards — including consignment-sold cards,
since the second branch of the disjunction is byte-identical to the old
implementation.

**Recommendation: ship commit 5 as planned.** Verifiable via spot-check:
open a consignment-sold card pre-commit-5 and post-commit-5; SOLD ribbon,
realized P&L, displayValue should all match. If anything differs, commit
5 has a bug; revert before commit 6 ships. **Caveat:** the dead-code
guarantee assumes no out-of-band writes to `cards.sold_price` or
`cards.status='sold'` between commit 1 and commit 6 — no ad-hoc UPDATEs
via Query Editor for testing, no manual backfill scripts populating the
columns. If a row gets populated out-of-band during that window, the new
isSold branch fires and the spot-check above no longer covers the change
surface; either re-run the spot-check against the populated row or NULL
the test data before shipping commit 5.

### OQ-7 — What happens if the user has an open consignment AND has already self-sold?

Edge case: a user with `cards.status='sold'` somehow also gets a new
consignment created (race or admin error). The card has both signals.
`isSold` returns true (either branch satisfies). The display picks
self-sold (`card.status === "sold"` checked first in displayValue).
ConsignBlock's status pill renders the consignment status, which may
contradict the self-sold display.

**Recommendation: defensive guard in `consignments/create.js`** —
reject a new consignment when `cards.status='sold'`. One-line check;
mirrors the mark-sold guard that rejects creating a sale when an open
consignment exists. **Ship as commit 2a** (between the mark-sold Lambda
in commit 2 and the read-path changes in commit 3) — touching the
existing consignment endpoint is a separate concern from adding the new
mark-sold endpoint, and a dedicated commit keeps the guard independently
revertable if a regression surfaces.

### OQ-8 — Auction house "Other" suggestion vs the `other` venue type

The form's auction suggestions include 7 named houses. Users selling at
a less-known auction house (e.g. "Robert Edward Auctions") will type a
custom value in the auction-house field — but the spec also has a
separate `'other'` venue type for non-auction, non-show sales.

**Should "auction at a non-suggested house" go through `venueType='auction'`
with a custom auction_house, or through `venueType='other'`?**

- (A) `venueType='auction'` with custom `auction_house` text. Preserves
  the analytical "this was an auction sale" classification.
- (B) `venueType='other'`. Loses the auction signal but keeps the
  auction-house field reserved for "known platforms."

**Recommendation: (A).** The locked decisions explicitly say "Auction
— text input with suggested values list, allow custom" — datalist is
the right primitive. Analytical value of "this was an auction" outweighs
strict enumeration. The "other" venue is for non-auction, non-show
sales (private dealer, friend, marketplace).

---

*End of plan. Awaiting human review before §6 commits begin.*
