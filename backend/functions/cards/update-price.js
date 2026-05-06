const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidPrice } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { manualPrice } = body;
  const clearing = manualPrice === null || manualPrice === undefined;
  if (!clearing && !isValidPrice(manualPrice)) {
    return json(400, { error: "manualPrice must be a non-negative number under 10,000,000 or null" });
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const existing = await db.query(
    "SELECT id FROM cards WHERE id = $1 AND user_id = $2",
    [cardId, userId]
  );
  if (existing.rows.length === 0) return json(404, { error: "Card not found" });

  const price = clearing ? null : parseFloat(manualPrice);
  await db.query("UPDATE cards SET manual_price = $1 WHERE id = $2", [price, cardId]);

  return json(200, { id: cardId, manualPrice: price });
};
