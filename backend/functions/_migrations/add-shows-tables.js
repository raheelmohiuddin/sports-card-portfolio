// Migration: card_shows (catalog from TCDB) + user_shows (per-collector
// "I'm attending" tracking).
//
// card_shows is keyed by an internal UUID, but tcdb_id is UNIQUE so the
// import Lambda can upsert on it. Indexed for the API's two main filter
// shapes (date-then-state, state-then-date).
//
// user_shows has a UNIQUE (user_id, card_show_id) so the attending
// toggle is idempotent — second click is a no-op via ON CONFLICT.
//
// Idempotent.
//   aws lambda invoke --function-name scp-migration-add-shows-tables --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS card_shows (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tcdb_id     INT          UNIQUE NOT NULL,
      name        VARCHAR(500),
      venue       VARCHAR(500),
      city        VARCHAR(200),
      state       VARCHAR(50),
      country     VARCHAR(100),
      show_date   DATE,
      start_time  VARCHAR(50),
      end_time    VARCHAR(50),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_card_shows_date_state ON card_shows (show_date, state)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_card_shows_state_date ON card_shows (state, show_date)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_shows (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
      card_show_id  UUID NOT NULL REFERENCES card_shows(id) ON DELETE CASCADE,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, card_show_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_user_shows_user ON user_shows (user_id)`);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "shows tables ensured" }),
  };
};
