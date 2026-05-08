// One-off DESTRUCTIVE truncate. Wipes every row from every user-data table
// in FK order so the app starts from an empty state.
//
// Order: consignments → cards → portfolio_snapshots → users.
// (consignments and cards have ON DELETE CASCADE on user_id, but explicit
// DELETEs make the operation auditable in CloudWatch logs.) portfolio_snapshots
// has no FK constraint to users — deleting users wouldn't cascade to it,
// so we wipe it explicitly to leave nothing behind.
//
// S3-stored card images and avatars are NOT touched by this Lambda. Any
// remaining objects in the bucket are orphaned and can be deleted manually
// or via an S3 lifecycle rule.
//
//   aws lambda invoke --function-name scp-migration-truncate-all --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  const counts = {};

  // Single transaction so a partial failure leaves nothing half-deleted.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const consignments = await client.query("DELETE FROM consignments");
    counts.consignments = consignments.rowCount;
    const cards = await client.query("DELETE FROM cards");
    counts.cards = cards.rowCount;
    const snapshots = await client.query("DELETE FROM portfolio_snapshots");
    counts.portfolio_snapshots = snapshots.rowCount;
    const users = await client.query("DELETE FROM users");
    counts.users = users.rowCount;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Verify by counting after.
  const verify = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM consignments)         AS consignments,
      (SELECT COUNT(*) FROM cards)                AS cards,
      (SELECT COUNT(*) FROM portfolio_snapshots)  AS portfolio_snapshots,
      (SELECT COUNT(*) FROM users)                AS users
  `);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      deleted: counts,
      remaining: verify.rows[0],
    }),
  };
};
