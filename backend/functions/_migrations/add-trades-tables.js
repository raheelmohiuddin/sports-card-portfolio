// One-off migration: adds the trades + trade_cards tables and a status
// column on cards (NULL = active, 'traded' = traded away). Idempotent.
//
//   aws lambda invoke --function-name scp-migration-add-trades-tables \
//     --region us-east-1 out.json
//
// Schema notes:
//   • cards.status defaults to NULL so existing rows are unchanged. The
//     read paths treat NULL as "active". Sold cards continue to surface
//     via the consignments JOIN — status is reserved for trade lifecycle.
//   • trade_cards snapshots key card metadata (player, year, brand, grade,
//     estimated_value, allocated_cost) at trade time so the trade history
//     stays accurate even if the card is later edited or re-traded.
//   • allocated_cost is filled per-side: given side gets a copy of the
//     card's my_cost at trade time; received side starts NULL and is
//     populated when /trades/confirm-cost lands.
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS status TEXT");

  await db.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      traded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cash_given    DECIMAL(12,2) DEFAULT 0,
      cash_received DECIMAL(12,2) DEFAULT 0,
      notes         TEXT,
      status        TEXT NOT NULL DEFAULT 'pending'
    )
  `);
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades(user_id, traded_at DESC)"
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS trade_cards (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_id        UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      card_id         UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      side            TEXT NOT NULL CHECK (side IN ('given', 'received')),
      cert_number     VARCHAR(50),
      player_name     VARCHAR(255),
      year            VARCHAR(10),
      brand           VARCHAR(100),
      grade           VARCHAR(10),
      estimated_value DECIMAL(10,2),
      allocated_cost  DECIMAL(10,2)
    )
  `);
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_trade_cards_trade ON trade_cards(trade_id)"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_trade_cards_card ON trade_cards(card_id)"
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "trades + trade_cards + cards.status applied" }),
  };
};
