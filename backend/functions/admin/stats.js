// GET /admin/stats — high-level aggregates for the admin dashboard.
//
// Single round-trip: each subquery is a scalar so we can return them all
// from one DB call. Total portfolio value uses COALESCE(manual_price,
// estimated_value) to mirror what the rest of the app considers a card's
// current value when both fields are populated.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const result = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users)                                         AS total_users,
      (SELECT COUNT(*) FROM cards)                                         AS total_cards,
      (SELECT COALESCE(SUM(COALESCE(manual_price, estimated_value)), 0)
         FROM cards)                                                       AS total_value,
      (SELECT COUNT(*) FROM consignments
         WHERE status NOT IN ('declined', 'sold'))                         AS open_consignments
  `);

  const row = result.rows[0];
  return json(200, {
    totalUsers:        parseInt(row.total_users, 10),
    totalCards:        parseInt(row.total_cards, 10),
    totalValue:        parseFloat(row.total_value),
    openConsignments:  parseInt(row.open_consignments, 10),
  });
};
