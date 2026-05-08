// Adds an end_date column to card_shows and merges consecutive-date
// duplicates into single multi-day rows.
//
// TCDB lists each day of a multi-day show as a separate <li> with its own
// tcdb_id, so the scraper inserts (e.g.) a Friday + Saturday + Sunday for
// the same physical event. This migration:
//
//   1. ALTER TABLE card_shows ADD COLUMN IF NOT EXISTS end_date DATE
//   2. Identifies "runs" of consecutive show_dates within each
//      (name, venue, city, state) group via the standard
//      "date - row_number" gaps-and-islands trick.
//   3. For each run with > 1 day:
//        UPDATE the earliest row → end_date = MAX(show_date)
//        DELETE every other row in the run.
//
// Idempotent: re-runs are safe (column add is conditional, dedup pass
// only finds runs that still exist; once consolidated there are no
// further consecutive duplicates to merge).
//
//   aws lambda invoke --function-name scp-migration-add-end-date-and-merge-shows --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();

  await db.query("ALTER TABLE card_shows ADD COLUMN IF NOT EXISTS end_date DATE");

  const client = await db.connect();
  let runsFound = 0, rowsKept = 0, rowsDeleted = 0;

  try {
    await client.query("BEGIN");

    // Identify runs. The PARTITION key intentionally includes country
    // (defensive — same city/state name across countries is theoretical
    // but cheap to guard against). NULLs in PARTITION BY are treated as
    // equal in PostgreSQL, so rows with missing names still group naturally.
    const runs = await client.query(`
      WITH labelled AS (
        SELECT id, name, venue, city, state, country, show_date,
          (show_date - (ROW_NUMBER() OVER (
            PARTITION BY name, venue, city, state, country
            ORDER BY show_date
          ))::int) AS run_anchor
        FROM card_shows
      )
      SELECT
        name, venue, city, state, country, run_anchor,
        MIN(show_date)                    AS start_date,
        MAX(show_date)                    AS end_date,
        COUNT(*)                          AS days,
        (ARRAY_AGG(id ORDER BY show_date))[1] AS keep_id,
        ARRAY_AGG(id ORDER BY show_date)  AS all_ids
      FROM labelled
      GROUP BY name, venue, city, state, country, run_anchor
      HAVING COUNT(*) > 1
    `);

    runsFound = runs.rowCount;

    for (const r of runs.rows) {
      // Update the keeper with the run's end date.
      await client.query(
        `UPDATE card_shows
         SET end_date = $1, updated_at = NOW()
         WHERE id = $2`,
        [r.end_date, r.keep_id]
      );
      rowsKept += 1;

      // Drop every other id in this run.
      const others = r.all_ids.slice(1);
      if (others.length > 0) {
        const del = await client.query(
          "DELETE FROM card_shows WHERE id = ANY($1::uuid[])",
          [others]
        );
        rowsDeleted += del.rowCount;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Final count for sanity.
  const totalRow = await db.query("SELECT COUNT(*) AS n FROM card_shows");
  const total = parseInt(totalRow.rows[0].n, 10);
  const multiDayRow = await db.query("SELECT COUNT(*) AS n FROM card_shows WHERE end_date IS NOT NULL");
  const multiDay = parseInt(multiDayRow.rows[0].n, 10);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      runsFound,
      rowsKept,
      rowsDeleted,
      tableTotal: total,
      multiDayRows: multiDay,
    }),
  };
};
