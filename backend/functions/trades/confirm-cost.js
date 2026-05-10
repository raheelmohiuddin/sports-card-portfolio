// POST /trades/confirm-cost — finalize a pending trade by allocating
// cost basis to each received card.
//
// Atomic across:
//   1. UPDATE cards.my_cost for each (cert_number → cost) allocation
//   2. UPDATE trade_cards.allocated_cost for the same card on the
//      'received' side (so trade history captures the allocation)
//   3. UPDATE trades.status from 'pending' → 'executed'
//
// Validates that the trade exists, belongs to the caller, is still
// 'pending', and that every certNumber in the payload corresponds to
// one of THIS trade's received cards. Cost values must be non-negative.
//
// Body shape: { tradeId, allocations: [{ certNumber, cost }, ...] }
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidCertNumber, isValidPrice } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { tradeId } = body;
  const allocations = Array.isArray(body.allocations) ? body.allocations : [];

  if (!isValidId(tradeId)) return json(400, { error: "Invalid tradeId" });
  if (allocations.length === 0) {
    return json(400, { error: "allocations must be a non-empty array" });
  }
  for (const a of allocations) {
    if (!a || !isValidCertNumber(a.certNumber)) {
      return json(400, { error: "Invalid certNumber in allocations" });
    }
    if (!isValidPrice(a.cost)) {
      return json(400, { error: "cost must be a non-negative number" });
    }
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Trade must exist, belong to caller, and still be pending. We
    // re-check status inside the transaction so a concurrent confirm
    // can't double-execute.
    const trade = await client.query(
      "SELECT status FROM trades WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [tradeId, userId]
    );
    if (trade.rows.length === 0) {
      throw Object.assign(new Error("Trade not found"), { httpStatus: 404 });
    }
    if (trade.rows[0].status !== "pending") {
      throw Object.assign(
        new Error(`Trade is ${trade.rows[0].status}, cannot allocate cost`),
        { httpStatus: 400 }
      );
    }

    // Pull the set of received certs we expect for this trade so we can
    // reject foreign certs in the payload.
    const expected = await client.query(
      `SELECT cert_number FROM trade_cards
       WHERE trade_id = $1 AND side = 'received'`,
      [tradeId]
    );
    const expectedSet = new Set(expected.rows.map((r) => r.cert_number));
    for (const a of allocations) {
      if (!expectedSet.has(a.certNumber.trim())) {
        throw Object.assign(
          new Error(`Cert ${a.certNumber} is not part of this trade`),
          { httpStatus: 400 }
        );
      }
    }

    // Apply allocations as two batched UPDATEs (one per table) keyed on
    // unnest() parallel arrays. Avoids 2N round-trips when a trade has
    // many received cards.
    const certs = allocations.map((a) => a.certNumber.trim());
    const costs = allocations.map((a) => Number(a.cost));

    const upd = await client.query(
      `UPDATE cards SET my_cost = v.cost
       FROM unnest($1::text[], $2::numeric[]) AS v(cert_number, cost)
       WHERE cards.user_id = $3 AND cards.cert_number = v.cert_number
       RETURNING cards.id, cards.cert_number`,
      [certs, costs, userId]
    );
    if (upd.rows.length !== allocations.length) {
      const found = new Set(upd.rows.map((r) => r.cert_number));
      const missing = certs.find((c) => !found.has(c));
      throw Object.assign(
        new Error(`Card with cert ${missing} not found`),
        { httpStatus: 404 }
      );
    }

    const costByCert = new Map(allocations.map((a) => [a.certNumber.trim(), Number(a.cost)]));
    const cardIds = upd.rows.map((r) => r.id);
    const cardCosts = upd.rows.map((r) => costByCert.get(r.cert_number));

    await client.query(
      `UPDATE trade_cards SET allocated_cost = v.cost
       FROM unnest($1::uuid[], $2::numeric[]) AS v(card_id, cost)
       WHERE trade_cards.trade_id = $3
         AND trade_cards.side = 'received'
         AND trade_cards.card_id = v.card_id`,
      [cardIds, cardCosts, tradeId]
    );

    await client.query(
      "UPDATE trades SET status = 'executed' WHERE id = $1",
      [tradeId]
    );

    await client.query("COMMIT");
    return json(200, { ok: true, tradeId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.httpStatus) return json(err.httpStatus, { error: err.message });
    console.error("Trade confirm-cost failed:", err);
    return json(500, { error: "Trade confirm-cost failed" });
  } finally {
    client.release();
  }
};
