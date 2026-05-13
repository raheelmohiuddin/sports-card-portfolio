-- 0007_pa_image_columns.sql
-- Per OQ-8 locked: PA add supports optional front + back image upload.
-- This migration extends potential_acquisitions with the image columns
-- needed to mirror the cards-table image storage pattern (S3 keys +
-- pre-signed upload URLs). Schema gap from 0005; fixed here.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS).

-- Column types mirror cards exactly (verified via information_schema):
--   s3_image_key, s3_back_image_key: varchar(500) — S3 object keys
--   image_url, back_image_url:       text         — external/legacy URLs
ALTER TABLE potential_acquisitions
  ADD COLUMN IF NOT EXISTS s3_image_key      varchar(500) NULL,
  ADD COLUMN IF NOT EXISTS s3_back_image_key varchar(500) NULL,
  ADD COLUMN IF NOT EXISTS image_url         text         NULL,
  ADD COLUMN IF NOT EXISTS back_image_url    text         NULL;
