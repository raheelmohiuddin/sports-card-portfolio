// One-off migration: adds the `my_cost` column to the cards table.
// Idempotent — safe to invoke repeatedly.
//
//   aws lambda invoke --function-name scp-migration-add-my-cost --region us-east-1 out.json
//
// Once verified, this Lambda + its CDK construct can be removed.
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS my_cost DECIMAL(10,2)");
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "my_cost column ensured on cards table" }),
  };
};
