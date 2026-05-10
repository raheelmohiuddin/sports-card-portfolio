// One-off migration: adds cardhedger_id + raw_comps to cards. Idempotent.
//
//   aws lambda invoke --function-name scp-migration-add-cardhedger-columns \
//     --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS cardhedger_id TEXT");
  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS raw_comps JSONB");

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "cardhedger columns applied" }),
  };
};
