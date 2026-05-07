const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");

// Returns the user's portfolio_snapshots time series, oldest → newest.
// Hard cap of 500 rows so a user with a long history doesn't blow up the chart.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT snapshot_at, total_value, card_count
     FROM portfolio_snapshots
     WHERE user_id = $1
     ORDER BY snapshot_at ASC
     LIMIT 500`,
    [userId]
  );

  return json(200, result.rows.map((r) => ({
    timestamp:  r.snapshot_at,
    totalValue: parseFloat(r.total_value),
    cardCount:  r.card_count,
  })));
};
