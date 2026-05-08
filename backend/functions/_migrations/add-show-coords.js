// Migration: card_shows.lat / card_shows.lng for proximity filtering.
//
// NUMERIC(9,6) gives ±999.999999 — well past the ±90 / ±180 ranges
// real coordinates need, with 6 decimal places (~11 cm precision,
// overkill for show-finder purposes but cheap to store).
//
// Index covers (lat, lng) so the Haversine bounding-box pre-filter
// in list-shows can use it (a true GIST index would be better but
// requires the postgis extension; this works for our row counts).
//
// Idempotent.
//   aws lambda invoke --function-name scp-migration-add-show-coords --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query("ALTER TABLE card_shows ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6)");
  await db.query("ALTER TABLE card_shows ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6)");
  await db.query("CREATE INDEX IF NOT EXISTS idx_card_shows_latlng ON card_shows (lat, lng)");

  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM card_shows)                                           AS total,
      (SELECT COUNT(*) FROM card_shows WHERE lat IS NOT NULL AND lng IS NOT NULL) AS geocoded
  `);
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      message: "lat/lng columns ensured",
      total:    parseInt(counts.rows[0].total,    10),
      geocoded: parseInt(counts.rows[0].geocoded, 10),
    }),
  };
};
