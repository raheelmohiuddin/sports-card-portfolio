// POST /shows/{id}/attending — flag the calling user as attending the
// given card show. Idempotent: the (user_id, card_show_id) UNIQUE on
// user_shows turns a second click into a no-op.
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, sanitize } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const showId = event.pathParameters?.id;
  if (!isValidId(showId)) return json(400, { error: "Invalid show id" });

  let body = {};
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }
  const notes = body.notes !== undefined ? sanitize(body.notes, 2000) : null;

  const db = await getPool();
  const userId = await ensureUser(
    db,
    claims.sub,
    claims.email,
    claims.given_name ?? null,
    claims.family_name ?? null,
  );

  // Verify the show exists.
  const exists = await db.query("SELECT id FROM card_shows WHERE id = $1", [showId]);
  if (exists.rows.length === 0) return json(404, { error: "Show not found" });

  await db.query(
    `INSERT INTO user_shows (user_id, card_show_id, notes)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, card_show_id) DO UPDATE
       SET notes = COALESCE(EXCLUDED.notes, user_shows.notes)`,
    [userId, showId, notes]
  );

  return json(200, { attending: true });
};
