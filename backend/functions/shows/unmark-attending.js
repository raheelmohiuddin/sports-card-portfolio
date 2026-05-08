// DELETE /shows/{id}/attending — un-flag the calling user from a show.
// 200 on success regardless of whether the row existed (idempotent).
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const showId = event.pathParameters?.id;
  if (!isValidId(showId)) return json(400, { error: "Invalid show id" });

  const db = await getPool();
  const userId = await ensureUser(
    db,
    claims.sub,
    claims.email,
    claims.given_name ?? null,
    claims.family_name ?? null,
  );

  await db.query(
    "DELETE FROM user_shows WHERE user_id = $1 AND card_show_id = $2",
    [userId, showId]
  );

  return json(200, { attending: false });
};
