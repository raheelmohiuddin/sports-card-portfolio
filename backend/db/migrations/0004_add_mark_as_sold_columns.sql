-- 0004_add_mark_as_sold_columns.sql
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
