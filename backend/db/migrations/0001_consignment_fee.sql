-- 0001_consignment_fee.sql
-- Adds the consignment-fee model to consignments.
--   consignment_fee_pct — percentage charged by the platform (e.g. 15.00 for 15%)
--   sellers_net        — what the collector actually receives:
--                        sellers_net = sold_price / (1 + consignment_fee_pct / 100)
-- Both columns are nullable and computed/maintained by the update-consignment
-- Lambda. They're surfaced to the collector in the ConsignBlock sidebar once a
-- consignment is marked "sold" and both inputs are present.
--
-- Idempotent: re-running this against a DB that already has the columns is a
-- no-op thanks to ADD COLUMN IF NOT EXISTS (Postgres 9.6+).

ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS consignment_fee_pct DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS sellers_net         DECIMAL(10, 2);
