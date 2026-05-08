// GET /admin/cards — every card in the system, joined to its owner.
//
// Joins on users so the response carries first/last/email alongside the
// card details — saves the frontend from a follow-up batch lookup. Returns
// estimated value as the same COALESCE(manual_price, estimated_value) the
// portfolio page uses.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const result = await db.query(`
    SELECT
      c.id,
      c.cert_number,
      c.year,
      c.brand,
      c.player_name,
      c.grade,
      c.grade_description,
      COALESCE(c.manual_price, c.estimated_value) AS estimated_value,
      c.added_at,
      u.given_name,
      u.family_name,
      u.email
    FROM cards c
    JOIN users u ON u.id = c.user_id
    ORDER BY c.added_at DESC
  `);

  const cards = result.rows.map((r) => ({
    id:               r.id,
    certNumber:       r.cert_number,
    year:             r.year,
    brand:            r.brand,
    playerName:       r.player_name,
    grade:            r.grade,
    gradeDescription: r.grade_description,
    estimatedValue:   r.estimated_value != null ? parseFloat(r.estimated_value) : null,
    addedAt:          r.added_at,
    user: {
      givenName:   r.given_name,
      familyName:  r.family_name,
      email:       r.email,
    },
  }));

  return json(200, cards);
};
