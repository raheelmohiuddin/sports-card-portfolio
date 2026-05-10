const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");

// Fast read of the user's portfolio. Returns whatever's currently in the DB
// — no CardHedger calls, no staleness check. Frontend pairs this with a
// background POST /portfolio/refresh to repopulate stale rows; that split is
// what lets the dashboard render in <1s even when many cards need refresh.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, manual_price, my_cost,
            estimated_value, avg_sale_price, last_sale_price,
            num_sales, price_source, value_last_updated
     FROM cards WHERE user_id = $1`,
    [userId]
  );

  let totalValue = 0;
  let totalCost  = 0;
  const cards = result.rows.map((row) => {
    const manualPrice  = row.manual_price    ? parseFloat(row.manual_price)    : null;
    const autoValue    = row.estimated_value ? parseFloat(row.estimated_value) : null;
    const displayValue = manualPrice ?? autoValue;
    const cost         = row.my_cost         ? parseFloat(row.my_cost)         : null;
    if (displayValue) totalValue += displayValue;
    if (cost)         totalCost  += cost;
    return {
      id:            row.id,
      manualPrice,
      estimatedValue: displayValue,
      avgSalePrice:   row.avg_sale_price  ? parseFloat(row.avg_sale_price)  : null,
      lastSalePrice:  row.last_sale_price ? parseFloat(row.last_sale_price) : null,
      numSales:       row.num_sales       ?? null,
      priceSource:    manualPrice !== null ? "manual" : (row.price_source ?? null),
    };
  });

  const finalTotal = Math.round(totalValue * 100) / 100;
  const finalCost  = Math.round(totalCost  * 100) / 100;

  // Write a portfolio_snapshots row at most once per 30 minutes per user.
  // Wrapped in try/catch so a snapshot failure never breaks the response.
  try {
    const last = await db.query(
      "SELECT snapshot_at FROM portfolio_snapshots WHERE user_id = $1 ORDER BY snapshot_at DESC LIMIT 1",
      [userId]
    );
    const minutesSince = last.rows[0]
      ? (Date.now() - new Date(last.rows[0].snapshot_at).getTime()) / 60000
      : Infinity;
    if (minutesSince > 30) {
      await db.query(
        "INSERT INTO portfolio_snapshots (user_id, total_value, total_cost, card_count) VALUES ($1, $2, $3, $4)",
        [userId, finalTotal, finalCost, cards.length]
      );
    }
  } catch (err) {
    console.warn("Snapshot write failed:", err.message);
  }

  return json(200, { totalValue: finalTotal, cards });
};
