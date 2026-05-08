// Migration: adds sold_price to consignments. Filled by the admin once a
// card actually sells; surfaces to the collector as the realized value
// and feeds the realized vs unrealized P&L split.
//
// Idempotent.
//   aws lambda invoke --function-name scp-migration-add-sold-price --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query("ALTER TABLE consignments ADD COLUMN IF NOT EXISTS sold_price DECIMAL(10,2)");
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "sold_price column ensured on consignments" }),
  };
};
