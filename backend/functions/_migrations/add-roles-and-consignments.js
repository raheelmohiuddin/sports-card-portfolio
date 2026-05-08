// Migration: role-based admin support + consignments table.
//
// Adds given_name / family_name / role to users, creates the consignments
// table, and indexes consignments by status (admin queue) and user (history).
// The unique partial index prevents the same user from spamming consignment
// requests for the same card while one is still open.
//
// Idempotent — invoke after every redeploy that ships a schema change:
//   aws lambda invoke --function-name scp-migration-add-roles-and-consignments --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS given_name  VARCHAR(80)");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS family_name VARCHAR(80)");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role        VARCHAR(20) NOT NULL DEFAULT 'collector'");

  await db.query(`
    CREATE TABLE IF NOT EXISTS consignments (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id         UUID         NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      type            VARCHAR(20)  NOT NULL,
      asking_price    DECIMAL(10,2),
      notes           TEXT,
      status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
      internal_notes  TEXT,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_consignments_status_created
      ON consignments (status, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_consignments_user_created
      ON consignments (user_id, created_at DESC)
  `);
  // Partial unique: one OPEN consignment per (user, card). Closed states
  // (declined, sold) don't count, so a user can re-list a card after a sale.
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_consignments_one_open_per_card
      ON consignments (user_id, card_id)
      WHERE status NOT IN ('declined', 'sold')
  `);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "roles + consignments schema applied" }),
  };
};
