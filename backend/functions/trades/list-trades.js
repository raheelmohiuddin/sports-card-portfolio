// GET /trades — return the user's executed trade history with cards.
//
// One JOIN + json_agg keeps it a single round-trip regardless of trade
// count. trade_cards columns are pre-snapshotted at trade time so we
// don't need to re-resolve the live cards table — that's intentional:
// trade history must stay accurate even if a card is later edited or
// re-traded. Pending trades are excluded; only status='executed' shows
// up so cancelled / mid-allocation trades don't leak into history.
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT t.id, t.traded_at, t.cash_given, t.cash_received, t.notes,
            COALESCE(
              json_agg(
                json_build_object(
                  'side',           tc.side,
                  'cardId',         tc.card_id,
                  'certNumber',     tc.cert_number,
                  'playerName',     tc.player_name,
                  'year',           tc.year,
                  'brand',          tc.brand,
                  'grade',          tc.grade,
                  'estimatedValue', tc.estimated_value,
                  'allocatedCost',  tc.allocated_cost
                )
                ORDER BY tc.side, tc.player_name
              ) FILTER (WHERE tc.id IS NOT NULL),
              '[]'::json
            ) AS cards
     FROM trades t
     LEFT JOIN trade_cards tc ON tc.trade_id = t.id
     WHERE t.user_id = $1 AND t.status = 'executed'
     GROUP BY t.id
     ORDER BY t.traded_at DESC`,
    [userId]
  );

  const trades = result.rows.map((row) => {
    const cashGiven    = row.cash_given    ? parseFloat(row.cash_given)    : 0;
    const cashReceived = row.cash_received ? parseFloat(row.cash_received) : 0;
    const cards = (row.cards ?? []).map((c) => ({
      ...c,
      estimatedValue: c.estimatedValue != null ? parseFloat(c.estimatedValue) : null,
      allocatedCost:  c.allocatedCost  != null ? parseFloat(c.allocatedCost)  : null,
    }));
    const given    = cards.filter((c) => c.side === "given");
    const received = cards.filter((c) => c.side === "received");

    // Trade-time net P&L. Snapshot values are frozen at execution so the
    // history reflects what the trade was worth at the time, not current
    // market. Cash is symmetric: cashReceived adds, cashGiven subtracts.
    const givenCostSum    = given.reduce((s, c) => s + (c.allocatedCost ?? 0), 0);
    const receivedValSum  = received.reduce((s, c) => s + (c.estimatedValue ?? 0), 0);
    const netPnl = (receivedValSum + cashReceived) - (givenCostSum + cashGiven);

    return {
      id:        row.id,
      tradedAt:  row.traded_at,
      cashGiven,
      cashReceived,
      notes:     row.notes ?? null,
      given,
      received,
      netPnl,
    };
  });

  return json(200, trades);
};
