// PATCH /admin/consignments/{id} — admin updates status and/or internal_notes.
//
// Both fields are optional; we only touch the columns that were sent. Status
// values are constrained to a known set so a malformed client can't poison
// the table with a bogus state. Updates `updated_at` so the admin UI can
// show "last touched" if needed in the future.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");
const { isValidId, sanitize } = require("../_validate");

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

  const { status, internalNotes } = body;
  const sets = [];
  const params = [];
  let p = 1;

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      return json(400, { error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` });
    }
    sets.push(`status = $${p++}`);
    params.push(status);
  }
  if (internalNotes !== undefined) {
    sets.push(`internal_notes = $${p++}`);
    params.push(sanitize(internalNotes, 5000));
  }

  if (sets.length === 0) return json(400, { error: "Nothing to update" });

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const result = await db.query(
    `UPDATE consignments SET ${sets.join(", ")}
     WHERE id = $${p}
     RETURNING id, status, internal_notes, updated_at`,
    params
  );
  if (result.rowCount === 0) return json(404, { error: "Not found" });

  const row = result.rows[0];
  return json(200, {
    id:            row.id,
    status:        row.status,
    internalNotes: row.internal_notes,
    updatedAt:     row.updated_at,
  });
};
