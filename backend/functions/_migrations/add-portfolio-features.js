// One-off migration: adds target_price to cards + creates portfolio_snapshots.
// Idempotent — safe to invoke repeatedly.
//
//   aws lambda invoke --function-name scp-migration-add-portfolio-features \
//     --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS target_price DECIMAL(10,2)");

  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id           BIGSERIAL PRIMARY KEY,
      user_id      UUID        NOT NULL,
      snapshot_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
      total_value  DECIMAL(12,2) NOT NULL,
      card_count   INT         NOT NULL
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_user_time
      ON portfolio_snapshots (user_id, snapshot_at DESC)
  `);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "portfolio features schema applied" }),
  };
};
