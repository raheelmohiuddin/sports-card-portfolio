// One-off migration: adds a grader column to cards (PSA / BGS / SGC).
// Existing rows are backfilled to 'PSA' since that was the only grader
// supported before this change. Idempotent.
//
//   aws lambda invoke --function-name scp-migration-add-grader-column \
//     --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS grader TEXT");
  // Backfill: every pre-existing card was a PSA lookup. Only sets where
  // grader IS NULL so re-running doesn't clobber any later edits.
  await db.query("UPDATE cards SET grader = 'PSA' WHERE grader IS NULL");
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "grader column added + backfilled to PSA" }),
  };
};
