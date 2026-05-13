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
