const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId } = require("../_validate");

// Returns recent sales history for a single card. Currently returns an empty
// array because eBay isn't yet connected — once EBAY_APP_ID is present we can
// hit the eBay Finding API here and map the completed listings into per-sale
// rows (date, sale price, grade). The frontend already handles the empty case
// with a "Sales history will be available once eBay pricing is connected"
// placeholder.
//
// Verifies the card belongs to the calling user before returning anything,
// even though the response itself is currently empty — keeps the contract
// consistent for when real sales start flowing through.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const owned = await db.query(
    "SELECT id FROM cards WHERE id = $1 AND user_id = $2",
    [cardId, userId]
  );
  if (owned.rows.length === 0) return json(404, { error: "Card not found" });

  if (!process.env.EBAY_APP_ID) {
    return json(200, { sales: [], source: null });
  }

  // TODO: when EBAY_APP_ID is set, fetch eBay completed listings for this card
  // and return them as { date, price, grade, title, url }.
  return json(200, { sales: [], source: "ebay" });
};
