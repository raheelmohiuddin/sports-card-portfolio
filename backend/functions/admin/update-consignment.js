// PATCH /admin/consignments/{id} — admin updates status and/or internal_notes.
//
// Both fields are optional; we only touch the columns that were sent. Status
// values are constrained to a known set so a malformed client can't poison
// the table with a bogus state. Updates `updated_at` so the admin UI can
// show "last touched" if needed in the future.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");
const { isValidId, sanitize, isValidPrice } = require("../_validate");

const VALID_STATUSES = new Set(["pending", "in_review", "listed", "sold", "declined"]);

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const id = event.pathParameters?.id;
  if (!isValidId(id)) return json(400, { error: "Invalid consignment id" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { status, internalNotes, soldPrice, consignmentFeePct } = body;
  const sets = [];
  const params = [];
  let p = 1;

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      return json(400, { error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` });
    }
    sets.push(`status = $${p++}`);
    params.push(status);
    // ever_declined latches to true on first decline and never reverts.
    // Set it in the same UPDATE so an outage between the two writes can't
    // leave the audit flag inconsistent with status.
    if (status === "declined") {
      sets.push(`ever_declined = TRUE`);
    }
  }
  if (internalNotes !== undefined) {
    sets.push(`internal_notes = $${p++}`);
    params.push(sanitize(internalNotes, 5000));
  }
  // soldPrice — nullable; admin clears it by sending null. We don't gate
  // on status here (admin might set price BEFORE flipping status to sold),
  // but the value is only surfaced to collectors when status is "sold".
  if (soldPrice !== undefined) {
    if (soldPrice !== null && !isValidPrice(soldPrice)) {
      return json(400, { error: "soldPrice must be a non-negative number under 10,000,000" });
    }
    sets.push(`sold_price = $${p++}`);
    params.push(soldPrice === null ? null : parseFloat(soldPrice));
  }
  // consignmentFeePct — percentage (0–100), e.g. 15 = 15%. Nullable so the
  // admin can clear it by sending null. Stored as DECIMAL(5,2).
  if (consignmentFeePct !== undefined) {
    if (consignmentFeePct !== null) {
      const n = Number(consignmentFeePct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return json(400, { error: "consignmentFeePct must be a number between 0 and 100" });
      }
    }
    sets.push(`consignment_fee_pct = $${p++}`);
    params.push(consignmentFeePct === null ? null : parseFloat(consignmentFeePct));
  }

  // Whenever sold_price OR consignment_fee_pct changes, recompute sellers_net
  // server-side using the post-update values. We read the current row first
  // so a partial patch (e.g. only soldPrice) still computes net against the
  // existing fee, and vice-versa. Sets to NULL whenever either input is
  // missing so the collector never sees a stale half-computed figure.
  if (soldPrice !== undefined || consignmentFeePct !== undefined) {
    const cur = await db.query(
      `SELECT sold_price, consignment_fee_pct FROM consignments WHERE id = $1`,
      [id]
    );
    if (cur.rowCount === 0) return json(404, { error: "Not found" });

    const finalSoldPrice = soldPrice !== undefined
      ? (soldPrice === null ? null : parseFloat(soldPrice))
      : (cur.rows[0].sold_price != null ? parseFloat(cur.rows[0].sold_price) : null);
    const finalFeePct = consignmentFeePct !== undefined
      ? (consignmentFeePct === null ? null : parseFloat(consignmentFeePct))
      : (cur.rows[0].consignment_fee_pct != null ? parseFloat(cur.rows[0].consignment_fee_pct) : null);

    const sellersNet = (finalSoldPrice != null && finalFeePct != null)
      ? Math.round((finalSoldPrice / (1 + finalFeePct / 100)) * 100) / 100
      : null;

    sets.push(`sellers_net = $${p++}`);
    params.push(sellersNet);
  }

  if (sets.length === 0) return json(400, { error: "Nothing to update" });

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const result = await db.query(
    `UPDATE consignments SET ${sets.join(", ")}
     WHERE id = $${p}
     RETURNING id, user_id, card_id, status, internal_notes,
               sold_price, consignment_fee_pct, sellers_net, updated_at`,
    params
  );
  if (result.rowCount === 0) return json(404, { error: "Not found" });

  const row = result.rows[0];

  // On a decline, mirror the block into consignment_blocks keyed on
  // (user_id, cert_number) so the block survives the user deleting and
  // re-adding the card. Idempotent via the table's primary key — repeated
  // decline-toggles by the admin won't error.
  if (status === "declined") {
    await db.query(
      `INSERT INTO consignment_blocks (user_id, cert_number, reason)
       SELECT $1, cert_number, 'declined' FROM cards WHERE id = $2
       ON CONFLICT (user_id, cert_number) DO NOTHING`,
      [row.user_id, row.card_id]
    );
  }
  return json(200, {
    id:                 row.id,
    status:             row.status,
    internalNotes:      row.internal_notes,
    soldPrice:          row.sold_price          != null ? parseFloat(row.sold_price)          : null,
    consignmentFeePct:  row.consignment_fee_pct != null ? parseFloat(row.consignment_fee_pct) : null,
    sellersNet:         row.sellers_net         != null ? parseFloat(row.sellers_net)         : null,
    updatedAt:          row.updated_at,
  });
};
