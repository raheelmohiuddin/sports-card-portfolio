const { getPool, ensureUser } = require("../_db");
const { fetchMarketValue } = require("./pricing");
const { json } = require("../_response");

const STALE_HOURS = 24;

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, player_name, year, brand, card_number, grade,
            manual_price,
            estimated_value, avg_sale_price, last_sale_price,
            num_sales, price_source, value_last_updated
     FROM cards WHERE user_id = $1`,
    [userId]
  );

  const now = new Date();

  await Promise.all(
    result.rows.map(async (row) => {
      if (row.manual_price !== null && row.manual_price !== undefined) return;

      const lastUpdated = row.value_last_updated ? new Date(row.value_last_updated) : null;
      const stale =
        !lastUpdated ||
        (now.getTime() - lastUpdated.getTime()) / 3600000 > STALE_HOURS;

      if (!stale) return;

      const pricing = await fetchMarketValue({
        playerName: row.player_name,
        year:       row.year,
        brand:      row.brand,
        cardNumber: row.card_number,
        grade:      row.grade,
        certNumber: row.id,
      });

      if (!pricing) return;

      await db.query(
        `UPDATE cards
         SET estimated_value    = $1,
             avg_sale_price     = $2,
             last_sale_price    = $3,
             num_sales          = $4,
             price_source       = $5,
             value_last_updated = NOW()
         WHERE id = $6`,
        [pricing.avgSalePrice, pricing.avgSalePrice, pricing.lastSalePrice,
         pricing.numSales, pricing.source, row.id]
      );

      row.estimated_value = pricing.avgSalePrice;
      row.avg_sale_price  = pricing.avgSalePrice;
      row.last_sale_price = pricing.lastSalePrice;
      row.num_sales       = pricing.numSales;
      row.price_source    = pricing.source;
    })
  );

  let totalValue = 0;
  const cards = result.rows.map((row) => {
    const manualPrice  = row.manual_price    ? parseFloat(row.manual_price)    : null;
    const autoValue    = row.estimated_value ? parseFloat(row.estimated_value) : null;
    const displayValue = manualPrice ?? autoValue;
    if (displayValue) totalValue += displayValue;
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
        "INSERT INTO portfolio_snapshots (user_id, total_value, card_count) VALUES ($1, $2, $3)",
        [userId, finalTotal, cards.length]
      );
    }
  } catch (err) {
    console.warn("Snapshot write failed:", err.message);
  }

  return json(200, { totalValue: finalTotal, cards });
};
