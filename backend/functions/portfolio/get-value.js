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

  // Cards + executed-trade count fetched in parallel — same connection pool,
  // independent queries. LATERAL pulls the most-recent consignment status
  // per card (same pattern as cards/get-card.js) so the held-only filter
  // below can exclude consignment-sold cards from the dashboard totals.
  const [result, tradeCount] = await Promise.all([
    db.query(
      `SELECT c.id, c.manual_price, c.my_cost,
              c.estimated_value, c.estimate_price,
              c.avg_sale_price, c.last_sale_price,
              c.num_sales, c.price_source, c.value_last_updated,
              c.status,
              cn.status AS consignment_status
       FROM cards c
       LEFT JOIN LATERAL (
         SELECT status FROM consignments
         WHERE card_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) cn ON TRUE
       WHERE c.user_id = $1`,
      [userId]
    ),
    db.query(
      "SELECT COUNT(*)::int AS n FROM trades WHERE user_id = $1 AND status = 'executed'",
      [userId]
    ),
  ]);

  let totalValue = 0;
  let totalCost  = 0;
  const cards = result.rows.map((row) => {
    const manualPrice    = row.manual_price    ? parseFloat(row.manual_price)    : null;
    const estimatePrice  = row.estimate_price  ? parseFloat(row.estimate_price)  : null;
    const estimatedValue = row.estimated_value ? parseFloat(row.estimated_value) : null;
    // Same precedence as the frontend's effectiveValue helper (portfolio.js):
    // manual override wins, then the valuation-rebuild estimate_price column,
    // then the legacy estimated_value fallback. Without this, the API's
    // totalValue (and the portfolio_snapshots rows it writes) used to anchor
    // on estimated_value only — which diverges from estimate_price for every
    // refreshed card and made the /portfolio/history chart undercount.
    const displayValue = manualPrice ?? estimatePrice ?? estimatedValue;
    const cost         = row.my_cost           ? parseFloat(row.my_cost)         : null;
    // Held-only filter for dashboard hero totals. Sold cards (either
    // self-sold via cards.status='sold' or consignment-sold via
    // consignments.status='sold') have realized values that belong in a
    // separate rollup — computed frontend-side in summarizePortfolio.
    // Traded cards (cards.status='traded') are also excluded by the NULL
    // check. JS equivalent of:
    //   c.status IS NULL AND (cn.status IS NULL OR cn.status <> 'sold')
    // The cards array itself stays unfiltered — only the aggregates skip
    // sold/traded rows. See .agents/mark-as-sold-plan.md §3 + §6 commit 4.
    const isHeld = row.status === null && row.consignment_status !== "sold";
    if (isHeld && displayValue) totalValue += displayValue;
    if (isHeld && cost)         totalCost  += cost;
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

  return json(200, {
    totalValue: finalTotal,
    cards,
    tradesExecuted: tradeCount.rows[0]?.n ?? 0,
  });
};
