// GET /admin/stats — high-level aggregates for the admin dashboard.
//
// Single round-trip: each subquery is a scalar so we can return them all
// from one DB call. Total portfolio value uses COALESCE(manual_price,
// estimate_price, estimated_value) to mirror the frontend effectiveValue
// precedence (see portfolio/get-value.js). Same bug class as commit 12e207c —
// estimate_price was added by the valuation rebuild (migration 0002) and
// needs to sit between manual_price and estimated_value in every precedence
// chain.
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
      (SELECT COALESCE(SUM(COALESCE(manual_price, estimate_price, estimated_value)), 0)
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
