// One-shot helper invoked locally by the geocoding script. Takes a
// payload of city/state → coords mappings and applies them as
// UPDATE statements against card_shows. Designed for direct
// `aws lambda invoke` only, not exposed as an HTTP route.
//
// Payload:
//   { entries: [
//       { city: "Selinsgrove", state: "PA", country: "United States",
//         lat: 40.7995, lng: -76.8633 },
//       ...
//   ]}
//
// Country defaults to "United States" if omitted (current data is
// US-only). All matching shows for a given (city, state, country)
// triple get the same coords — one geocode lookup populates every
// show in that city.
const { getPool } = require("../_db");

exports.handler = async (event) => {
  const entries = Array.isArray(event?.entries) ? event.entries : [];
  if (entries.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "no entries in payload" }) };
  }

  const db = await getPool();
  const client = await db.connect();
  let updated = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");
    for (const e of entries) {
      const city    = (e.city    ?? "").trim();
      const state   = (e.state   ?? "").trim().toUpperCase();
      const country = (e.country ?? "United States").trim();
      const lat     = Number(e.lat);
      const lng     = Number(e.lng);
      if (!city || !state || !Number.isFinite(lat) || !Number.isFinite(lng)) { skipped += 1; continue; }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180)                  { skipped += 1; continue; }

      const res = await client.query(
        `UPDATE card_shows
         SET lat = $1, lng = $2, updated_at = NOW()
         WHERE city = $3 AND state = $4 AND country = $5`,
        [lat, lng, city, state, country]
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
      payloadEntries: entries.length,
      rowsUpdated: updated,
      payloadSkipped: skipped,
      tableTotal: parseInt(counts.rows[0].total, 10),
      tableGeocoded: parseInt(counts.rows[0].geocoded, 10),
    }),
  };
};
