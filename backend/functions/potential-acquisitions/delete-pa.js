// DELETE /potential-acquisitions/{id}
// Hard-delete (per OQ-1 locked). The PA list is curate-as-you-go;
// soft-delete clutter has no value. If users start losing rows they
// regret, revisit with a soft-delete column.
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const paId = event.pathParameters?.id;
  if (!isValidId(paId)) return json(400, { error: "Invalid PA id" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Ownership check is the WHERE clause — anyone trying to delete
  // another user's PA gets a 0-row result and a 404.
  const result = await db.query(
    "DELETE FROM potential_acquisitions WHERE id = $1 AND user_id = $2 RETURNING id",
    [paId, userId]
  );
  if (result.rowCount === 0) return json(404, { error: "PA not found" });

  return json(200, { id: paId, deleted: true });
};
