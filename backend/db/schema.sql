-- Run this once against your Aurora cluster after deploying infrastructure.
-- Connect via the RDS Query Editor or a bastion host.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub VARCHAR(255) UNIQUE NOT NULL,
  email       VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_number         VARCHAR(50) NOT NULL,
  year                VARCHAR(10),
  brand               VARCHAR(100),
  sport               VARCHAR(100),
  player_name         VARCHAR(255),
  card_number         VARCHAR(50),
  grade               VARCHAR(10),
  grade_description   VARCHAR(100),
  image_url           TEXT,
  s3_image_key        VARCHAR(500),
  psa_data            JSONB,
  estimated_value     DECIMAL(10, 2),
  value_last_updated  TIMESTAMPTZ,
  added_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, cert_number)
);

CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_player_name ON cards(player_name);
