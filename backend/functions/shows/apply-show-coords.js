// Direct-invoke helper used by the local Google geocoder. Three modes:
//
//   • { list: true }       → returns every show (id + venue + city +
//                             state + country) for the geocoder to
//                             enumerate. Paged client-side; the table
//                             is small enough (~3.7k rows) that one
//                             call is fine.
//   • { clear: true }      → wipes lat / lng on every show row.
//   • { entries: [...] }   → applies coords. Per-show precision —
//                             entries are { id, lat, lng }; we
//                             UPDATE by primary key so two shows in
//                             the same city with different venues can
//                             carry different coords.
//
// Not exposed as an HTTP route; aws lambda invoke only.
const { getPool } = require("../_db");

exports.handler = async (event) => {
  const db = await getPool();

  if (event?.list === true) {
    const rows = await db.query(
      "SELECT id, venue, city, state, country FROM card_shows ORDER BY id"
    );
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        mode: "list",
        count: rows.rowCount,
        shows: rows.rows,
      }),
    };
  }

  if (event?.clear === true) {
    const before = await db.query(
      "SELECT COUNT(*) AS n FROM card_shows WHERE lat IS NOT NULL OR lng IS NOT NULL"
    );
    const cleared = parseInt(before.rows[0].n, 10);
    await db.query(
      "UPDATE card_shows SET lat = NULL, lng = NULL, updated_at = NOW() WHERE lat IS NOT NULL OR lng IS NOT NULL"
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true, cleared, mode: "clear" }) };
  }

  const entries = Array.isArray(event?.entries) ? event.entries : [];
  if (entries.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "no entries in payload" }) };
  }

  const client = await db.connect();
  let updated = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");
    for (const e of entries) {
      const id  = typeof e.id === "string" ? e.id.trim() : null;
      const lat = Number(e.lat);
      const lng = Number(e.lng);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) { skipped += 1; continue; }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180)      { skipped += 1; continue; }

      const res = await client.query(
        "UPDATE card_shows SET lat = $1, lng = $2, updated_at = NOW() WHERE id = $3",
        [lat, lng, id]
      );
      updated += res.rowCount;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM card_shows)                                           AS total,
      (SELECT COUNT(*) FROM card_shows WHERE lat IS NOT NULL AND lng IS NOT NULL) AS geocoded
  `);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      mode: "apply",
      payloadEntries: entries.length,
      rowsUpdated:    updated,
      payloadSkipped: skipped,
      tableTotal:     parseInt(counts.rows[0].total,    10),
      tableGeocoded:  parseInt(counts.rows[0].geocoded, 10),
    }),
  };
};
