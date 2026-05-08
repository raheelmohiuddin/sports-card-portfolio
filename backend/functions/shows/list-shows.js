// GET /shows — upcoming shows joined to user_shows so each row carries
// an `attending` boolean and the user's notes (if any). One round-trip
// drives the full /shows page; the calendar, grid, filters, and toggle
// state all read from this response.
//
// Query params (all optional):
//   state   — 2-letter US code, exact match
//   from    — YYYY-MM-DD, defaults to today
//   to      — YYYY-MM-DD, no upper bound by default
//   q       — case-insensitive substring match against name OR city
//
// Hard limit of 1000 rows. With ~5k upcoming shows nationwide that's
// enough headroom for a default state-filtered query; client can narrow
// further with state + date range.
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(
    db,
    claims.sub,
    claims.email,
    claims.given_name ?? null,
    claims.family_name ?? null,
  );

  const qs = event.queryStringParameters ?? {};
  // state= accepts a comma-separated list of 2-letter codes (e.g.
  // "PA,NY,FL"). Empty string / missing → no state filter.
  const stateRaw = (qs.state ?? "").trim();
  const states = stateRaw
    ? stateRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : null;
  const from  = (qs.from ?? "").trim() || null;
  const to    = (qs.to   ?? "").trim() || null;
  const q     = (qs.q    ?? "").trim() || null;
  const qLike = q ? `%${q}%` : null;

  // Proximity is split into two switches:
  //
  //   centerActive  — centerLat + centerLng both finite. Drives the
  //                   ORDER BY (sort by Haversine distance ASC) and is
  //                   independent of any radius cutoff.
  //   radiusMeters  — only set when radiusMiles is also a positive
  //                   finite number. Drives the WHERE clause filter.
  //
  // This split lets the "Any" radius option from the frontend show
  // every show sorted nearest-to-farthest from the user's zip.
  const cLat   = Number(qs.centerLat);
  const cLng   = Number(qs.centerLng);
  const radMi  = Number(qs.radiusMiles);
  const centerActive = Number.isFinite(cLat) && Number.isFinite(cLng);
  const radiusMeters = centerActive && Number.isFinite(radMi) && radMi > 0
    ? radMi * 1609.344
    : null;

  const params = [userId, from, to, states, qLike,
                  centerActive ? cLat : null,
                  centerActive ? cLng : null,
                  radiusMeters];
  // Every nullable text/date param is cast explicitly. Postgres can't
  // infer types for a parameter whose only uses are `IS NULL` checks
  // and an `=`/`ILIKE` against a NULL value — pg-node sends NULL
  // without a type tag, and the planner refuses ("could not determine
  // data type of parameter $N"). The cast tells it once and the
  // expression compiles cleanly.
  const sql = `
    SELECT
      cs.id, cs.tcdb_id, cs.name, cs.venue, cs.city, cs.state, cs.country,
      cs.show_date, cs.end_date, cs.start_time, cs.end_time, cs.daily_times,
      cs.lat, cs.lng,
      (us.id IS NOT NULL) AS attending,
      us.notes            AS attending_notes
    FROM card_shows cs
    LEFT JOIN user_shows us
      ON us.card_show_id = cs.id AND us.user_id = $1
    WHERE COALESCE(cs.end_date, cs.show_date) >= COALESCE($2::date, CURRENT_DATE)
      AND ($3::date IS NULL OR cs.show_date <= $3::date)
      AND ($4::text[] IS NULL OR cs.state = ANY($4::text[]))
      AND ($5::text IS NULL OR cs.name ILIKE $5::text OR cs.city ILIKE $5::text)
      -- Haversine distance filter — applied only when a radius is set
      -- ($8::numeric NOT NULL). With "Any" radius the center coords
      -- still drive the ORDER BY below; this WHERE clause is skipped
      -- so every show shows up. Shows missing lat/lng are excluded
      -- when the filter is active. acos is clamped to 1.0 to dodge
      -- floating-point drift that would otherwise NaN the result.
      AND (
        $8::numeric IS NULL
        OR (
          cs.lat IS NOT NULL AND cs.lng IS NOT NULL
          AND 6371000 * acos(LEAST(1.0,
              cos(radians($6::numeric)) * cos(radians(cs.lat))
              * cos(radians(cs.lng) - radians($7::numeric))
              + sin(radians($6::numeric)) * sin(radians(cs.lat))
          )) <= $8::numeric
        )
      )
    ORDER BY
      -- When a center is provided, primary sort is great-circle
      -- distance ASC (nearest first), with shows missing coords going
      -- last via NULLS LAST. When no center is set the CASE evaluates
      -- to NULL for every row so the secondary date sort takes over.
      CASE
        WHEN $6::numeric IS NOT NULL AND cs.lat IS NOT NULL AND cs.lng IS NOT NULL THEN
          6371000 * acos(LEAST(1.0,
            cos(radians($6::numeric)) * cos(radians(cs.lat))
            * cos(radians(cs.lng) - radians($7::numeric))
            + sin(radians($6::numeric)) * sin(radians(cs.lat))
          ))
        ELSE NULL
      END NULLS LAST,
      cs.show_date ASC, cs.start_time ASC NULLS LAST
    LIMIT 1000
  `;
  const res = await db.query(sql, params);

  const shows = res.rows.map((r) => ({
    id:         r.id,
    tcdbId:     r.tcdb_id,
    name:       r.name,
    venue:      r.venue,
    city:       r.city,
    state:      r.state,
    country:    r.country,
    date:       r.show_date instanceof Date
                  ? r.show_date.toISOString().slice(0, 10)
                  : r.show_date,
    endDate:    r.end_date == null
                  ? null
                  : (r.end_date instanceof Date
                      ? r.end_date.toISOString().slice(0, 10)
                      : r.end_date),
    startTime:  r.start_time,
    endTime:    r.end_time,
    // pg's JSONB type comes back as a parsed object/array, so the
    // value is already structured — pass it through unchanged. Falls
    // back to null when the column is NULL (single-day shows).
    dailyTimes: Array.isArray(r.daily_times) ? r.daily_times : null,
    attending:  r.attending,
    attendingNotes: r.attending_notes ?? null,
  }));

  return json(200, shows);
};
