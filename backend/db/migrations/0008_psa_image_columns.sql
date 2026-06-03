-- 0008_psa_image_columns.sql
-- For the PSA official-scan feature: GetByCertNumber returns card data,
-- GetImagesByCertNumber returns the official front/back scan URLs. On a
-- successful card add we fetch those scans once and store them in S3, so
-- cards needs S3-key columns dedicated to the PSA-sourced images (kept
-- separate from the user-upload keys s3_image_key / s3_back_image_key).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- Rollback: ALTER TABLE cards DROP COLUMN IF EXISTS psa_front_s3_key,
--           DROP COLUMN IF EXISTS psa_back_s3_key;

-- Column types mirror the existing card image S3 keys exactly:
--   psa_front_s3_key, psa_back_s3_key: varchar(500) — S3 object keys
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS psa_front_s3_key varchar(500) NULL,
  ADD COLUMN IF NOT EXISTS psa_back_s3_key  varchar(500) NULL;
