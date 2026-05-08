// Bulk-import card shows from a JSON payload. Designed to be invoked
// directly (`aws lambda invoke --payload file://shows.json`), not exposed
// as an HTTP route. Payload shape:
//   { "shows": [
//       { "tcdbId": 17425, "name": "...", "venue": "...", "city": "...",
//         "state": "PA", "country": "United States",
//         "date": "2026-05-09", "startTime": "9:00 AM", "endTime": "2:00 PM" },
//       ...
//   ]}
//
// Upserts on tcdb_id so re-runs after a re-scrape only refresh changes.
// Inserts in batches inside a single transaction for throughput.
const { getPool } = require("../_db");

const BATCH = 200;

exports.handler = async (event) => {
  const shows = Array.isArray(event?.shows) ? event.shows : [];
  if (shows.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "no shows in payload" }) };
  }

  const db = await getPool();
  const client = await db.connect();
  let inserted = 0, updated = 0, skipped = 0;

  try {
    await client.query("BEGIN");

    for (let i = 0; i < shows.length; i += BATCH) {
      const slice = shows.slice(i, i + BATCH);
      // Build a multi-row INSERT with positional params per row.
      const values = [];
      const placeholders = [];
      slice.forEach((s, idx) => {
        const tcdbId = parseInt(s.tcdbId, 10);
        if (!Number.isFinite(tcdbId) || tcdbId <= 0) { skipped += 1; return; }
        const base = values.length;
        values.push(
          tcdbId,
          s.name      || null,
          s.venue     || null,
          s.city      || null,
          s.state     || null,
          s.country   || "United States",
          s.date      || null,
          s.startTime || null,
          s.endTime   || null,
        );
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
        );
      });
      if (placeholders.length === 0) continue;

      const sql = `
        INSERT INTO card_shows (tcdb_id, name, venue, city, state, country, show_date, start_time, end_time)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (tcdb_id) DO UPDATE SET
          name       = EXCLUDED.name,
          venue      = EXCLUDED.venue,
          city       = EXCLUDED.city,
          state      = EXCLUDED.state,
          country    = EXCLUDED.country,
          show_date  = EXCLUDED.show_date,
          start_time = EXCLUDED.start_time,
          end_time   = EXCLUDED.end_time,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `;
      const res = await client.query(sql, values);
      for (const row of res.rows) {
        if (row.inserted) inserted += 1; else updated += 1;
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

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      payloadCount: shows.length,
      inserted,
      updated,
      skipped,
      tableTotal: total,
    }),
  };
};
