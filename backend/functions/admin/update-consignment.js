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

  const { status, internalNotes, soldPrice } = body;
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

  if (sets.length === 0) return json(400, { error: "Nothing to update" });

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const result = await db.query(
    `UPDATE consignments SET ${sets.join(", ")}
     WHERE id = $${p}
     RETURNING id, user_id, card_id, status, internal_notes, sold_price, updated_at`,
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
    id:            row.id,
    status:        row.status,
    internalNotes: row.internal_notes,
    soldPrice:     row.sold_price != null ? parseFloat(row.sold_price) : null,
    updatedAt:     row.updated_at,
  });
};
