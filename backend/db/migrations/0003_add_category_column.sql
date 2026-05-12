-- 0003_add_category_column.sql
-- Adds category column to cards, sourced from CardHedger's card.category
-- field (e.g. "Football", "Basketball", "Pokemon"). Replaces the legacy
-- `sport` column which was sourced from PSA's cert.Sport (all-caps,
-- "FOOTBALL CARDS" style). The two columns coexist during transition —
-- `sport` is officially deprecated but stays in the schema; nothing
-- writes to it after this commit lands. See CONTEXT.md §10 for the
-- deprecation note.
-- Idempotent (IF NOT EXISTS).

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS category varchar(100);
