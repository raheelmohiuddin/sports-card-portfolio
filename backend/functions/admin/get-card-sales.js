// GET /admin/cards/{id}/sales — admin-scoped sales history.
//
// Mirrors portfolio/get-card-sales.js but skips the user_id ownership check.
// Currently returns an empty list because eBay isn't connected; kept on the
// admin path so the contract is in place for when real sales data starts
// flowing through and the consignments queue can show recent comps.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");
const { isValidId } = require("../_validate");

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const exists = await db.query("SELECT id FROM cards WHERE id = $1", [cardId]);
  if (exists.rows.length === 0) return json(404, { error: "Card not found" });

  if (!process.env.EBAY_APP_ID) {
    return json(200, { sales: [], source: null });
  }

  // TODO: when EBAY_APP_ID is set, fetch eBay completed listings for this card.
  return json(200, { sales: [], source: "ebay" });
};
