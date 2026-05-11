// GET /admin/consignments — every consignment request with user + card detail.
//
// Sort order: pending requests first (newest at the top), then everything
// else by recency. Internal notes are included since the admin UI shows them.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const result = await db.query(`
    SELECT
      cn.id,
      cn.type,
      cn.asking_price,
      cn.sold_price,
      cn.consignment_fee_pct,
      cn.sellers_net,
      cn.notes,
      cn.status,
      cn.internal_notes,
      cn.created_at,
      cn.updated_at,
      c.id            AS card_id,
      c.player_name,
      c.year,
      c.brand,
      c.grade,
      c.cert_number,
      COALESCE(c.manual_price, c.estimated_value) AS estimated_value,
      u.given_name,
      u.family_name,
      u.email
    FROM consignments cn
    JOIN cards c ON c.id = cn.card_id
    JOIN users u ON u.id = cn.user_id
    ORDER BY
      CASE WHEN cn.status = 'pending' THEN 0 ELSE 1 END,
      cn.created_at DESC
  `);

  const rows = result.rows.map((r) => ({
    id:                 r.id,
    type:               r.type,
    askingPrice:        r.asking_price        != null ? parseFloat(r.asking_price)        : null,
    soldPrice:          r.sold_price          != null ? parseFloat(r.sold_price)          : null,
    consignmentFeePct:  r.consignment_fee_pct != null ? parseFloat(r.consignment_fee_pct) : null,
    sellersNet:         r.sellers_net         != null ? parseFloat(r.sellers_net)         : null,
    notes:              r.notes,
    status:             r.status,
    internalNotes:      r.internal_notes,
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
    card: {
      id:             r.card_id,
      playerName:     r.player_name,
      year:           r.year,
      brand:          r.brand,
      grade:          r.grade,
      certNumber:     r.cert_number,
      estimatedValue: r.estimated_value != null ? parseFloat(r.estimated_value) : null,
    },
    user: {
      givenName:   r.given_name,
      familyName:  r.family_name,
      email:       r.email,
    },
  }));

  return json(200, rows);
};
