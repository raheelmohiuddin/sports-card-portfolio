// One-off migration: adds total_cost to portfolio_snapshots so the
// price-history chart can plot cost-basis alongside portfolio value.
// Idempotent.
//
//   aws lambda invoke --function-name scp-migration-add-snapshot-total-cost \
//     --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query(
    "ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12,2)"
  );
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "total_cost added to portfolio_snapshots" }),
  };
};
