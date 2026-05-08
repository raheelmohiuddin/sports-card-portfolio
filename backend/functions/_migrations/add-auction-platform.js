// Migration: adds auction_platform column to consignments. Populated when
// the collector chooses an "auction" consignment type and picks where the
// card should be auctioned (currently Fanatics or eBay). NULL for private
// sales.
//
// Idempotent — invoke after each redeploy that ships a schema change:
//   aws lambda invoke --function-name scp-migration-add-auction-platform --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query(
    "ALTER TABLE consignments ADD COLUMN IF NOT EXISTS auction_platform VARCHAR(20)"
  );

  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM consignments)                               AS total,
      (SELECT COUNT(*) FROM consignments WHERE auction_platform IS NULL) AS unset
  `);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      total: parseInt(counts.rows[0].total, 10),
      unset: parseInt(counts.rows[0].unset, 10),
    }),
  };
};
