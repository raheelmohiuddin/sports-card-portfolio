const { getPool, ensureUser } = require("../_db");

// Fetches recent eBay sold listings to estimate card value.
// Replace this stub with your chosen pricing API (eBay Finding API,
// CardLadder, 130point, etc.).
async function fetchMarketValue(playerName, year, brand, grade) {
  // TODO: Integrate a real pricing source.
  // Example with eBay Finding API:
  //   POST https://svcs.ebay.com/services/search/FindingService/v1
  //   operation=findCompletedItems, keywords="${year} ${brand} ${playerName} PSA ${grade}"
  //
  // Returning null signals "price unknown" — the UI shows N/A.
  return null;
}

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, player_name, year, brand, grade, estimated_value, value_last_updated
     FROM cards WHERE user_id = $1`,
    [userId]
  );

  const STALE_HOURS = 24;
  const now = new Date();
  let totalValue = 0;
  const updated = [];

  for (const row of result.rows) {
    const lastUpdated = row.value_last_updated ? new Date(row.value_last_updated) : null;
    const stale =
      !lastUpdated ||
      (now.getTime() - lastUpdated.getTime()) / 3600000 > STALE_HOURS;

    let value = row.estimated_value ? parseFloat(row.estimated_value) : null;

    if (stale) {
      const fetched = await fetchMarketValue(row.player_name, row.year, row.brand, row.grade);
      if (fetched !== null) {
        value = fetched;
        await db.query(
          "UPDATE cards SET estimated_value = $1, value_last_updated = NOW() WHERE id = $2",
          [value, row.id]
        );
      }
    }

    updated.push({ id: row.id, playerName: row.player_name, grade: row.grade, estimatedValue: value });
    if (value !== null) totalValue += value;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalValue, cards: updated }),
  };
};
