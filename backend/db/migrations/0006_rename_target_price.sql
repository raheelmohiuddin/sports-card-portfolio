-- 0006_rename_target_price.sql
-- Per OQ-7 locked: rename cards.target_price to cards.sell_target_price
-- for schema-and-code symmetry with potential_acquisitions.buy_target_price.
-- Ships atomically with the matching backend code reads/writes (commit 1b).
-- Frontend variable rename (targetPrice → sellTargetPrice) is part of
-- commit 3; visible UI label rename ("Target Price" → "Sell Target") is
-- part of commit 5.

ALTER TABLE cards RENAME COLUMN target_price TO sell_target_price;
