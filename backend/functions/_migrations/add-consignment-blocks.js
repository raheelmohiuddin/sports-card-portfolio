// Migration: permanent consignment block after a decline.
//
// Two pieces:
//
//   1. consignments.ever_declined — audit flag on the consignment row that
//      flips to true the moment status becomes "declined" and never
//      reverts. Useful for admin reporting; not used as a lookup at
//      consign-time because the row is FK-cascaded if the card is deleted.
//
//   2. consignment_blocks — the survival table. Keyed on
//      (user_id, cert_number) so the block persists even if the user
//      deletes the card and re-adds it with the same PSA cert. INSERTed
//      whenever update-consignment.js flips a row's status to "declined";
//      consulted by add-card.js, get-card.js, get-cards.js, and the
//      consign-create endpoint.
//
// Idempotent — invoke after each redeploy that ships a schema change:
//   aws lambda invoke --function-name scp-migration-add-consignment-blocks --region us-east-1 out.json
//
// Backfills: any existing consignments row with status='declined' gets
// ever_declined=true AND a corresponding consignment_blocks row, so a
// decline issued before this migration still enforces the permanent block.
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query(
    "ALTER TABLE consignments ADD COLUMN IF NOT EXISTS ever_declined BOOLEAN NOT NULL DEFAULT FALSE"
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS consignment_blocks (
      user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cert_number VARCHAR(50)  NOT NULL,
      blocked_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      reason      VARCHAR(20)  NOT NULL DEFAULT 'declined',
      PRIMARY KEY (user_id, cert_number)
    )
  `);

  // Backfill ever_declined on existing declined consignments.
  const flagged = await db.query(
    "UPDATE consignments SET ever_declined = TRUE WHERE status = 'declined' AND ever_declined = FALSE RETURNING id"
  );

  // Seed consignment_blocks for every previously-declined consignment so
  // existing decline decisions enforce the permanent block immediately.
  const seeded = await db.query(`
    INSERT INTO consignment_blocks (user_id, cert_number, reason)
    SELECT cn.user_id, c.cert_number, 'declined'
    FROM consignments cn
    JOIN cards c ON c.id = cn.card_id
    WHERE cn.status = 'declined'
    ON CONFLICT (user_id, cert_number) DO NOTHING
    RETURNING user_id
  `);

  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM consignments WHERE ever_declined = TRUE) AS ever_declined_rows,
      (SELECT COUNT(*) FROM consignment_blocks)                       AS block_rows
  `);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      everDeclinedFlagged: flagged.rowCount,
      blocksSeeded:        seeded.rowCount,
      everDeclinedRows:    parseInt(counts.rows[0].ever_declined_rows, 10),
      blockRows:           parseInt(counts.rows[0].block_rows,         10),
    }),
  };
};
