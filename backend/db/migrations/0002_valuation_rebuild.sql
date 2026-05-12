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
