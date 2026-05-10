// One-off migration: adds cardhedger_image_url to cards. Idempotent.
//
//   aws lambda invoke --function-name scp-migration-add-cardhedger-image-url \
//     --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS cardhedger_image_url TEXT");
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "cardhedger_image_url applied" }),
  };
};
