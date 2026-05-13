const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidPrice } = require("../_validate");

// Partial update endpoint — currently supports myCost only, but the design
// (collect SET clauses dynamically) makes adding new editable fields trivial.
//
// PUT /cards/{id}  body: { myCost?: number | null }
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

  const setClauses = [];
  const values = [];

  // myCost — null to clear, a non-negative number to set.
  if ("myCost" in body) {
    const v = body.myCost;
    if (v === null) {
      values.push(null);
    } else if (isValidPrice(v)) {
      values.push(parseFloat(v));
    } else {
      return json(400, { error: "myCost must be a non-negative number under 10,000,000 or null" });
    }
    setClauses.push(`my_cost = $${values.length}`);
  }

  // sellTargetPrice — null to clear, a non-negative number to set.
  if ("sellTargetPrice" in body) {
    const v = body.sellTargetPrice;
    if (v === null) {
      values.push(null);
    } else if (isValidPrice(v)) {
      values.push(parseFloat(v));
    } else {
      return json(400, { error: "sellTargetPrice must be a non-negative number under 10,000,000 or null" });
    }
    setClauses.push(`sell_target_price = $${values.length}`);
  }

  if (setClauses.length === 0) return json(400, { error: "No fields to update" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const existing = await db.query(
    "SELECT id FROM cards WHERE id = $1 AND user_id = $2",
    [cardId, userId]
  );
  if (existing.rows.length === 0) return json(404, { error: "Card not found" });

  // Append id and user_id as bind params for the WHERE clause
  values.push(cardId, userId);
  const idIdx     = values.length - 1;
  const userIdIdx = values.length;

  const result = await db.query(
    `UPDATE cards SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND user_id = $${userIdIdx}
     RETURNING id, my_cost, sell_target_price`,
    values
  );

  const row = result.rows[0];
  return json(200, {
    id: row.id,
    myCost:      row.my_cost      != null ? parseFloat(row.my_cost)      : null,
    sellTargetPrice: row.sell_target_price != null ? parseFloat(row.sell_target_price) : null,
  });
};
