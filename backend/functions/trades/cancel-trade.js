// POST /trades/cancel — atomic rollback of a pending trade.
//
// Used by the Trade Builder's Back button on the allocation screen, where
// the user wants to modify the trade before final cost-basis confirmation.
// Because /trades/execute already mutated inventory (marked given cards
// as 'traded', inserted received cards), simply navigating back without
// undoing the writes would leave the user wedged. This endpoint reverses
// every state change in a single transaction.
//
// Gated on trades.status='pending'. An already-executed trade (status
// 'executed', meaning confirm-cost has run) is intentionally
// uncancelable — at that point the user has explicitly committed and
// the cost basis is on the books.
//
// Body: { tradeId }
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  if (!isValidId(body.tradeId)) return json(400, { error: "Invalid tradeId" });
  const tradeId = body.tradeId;

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Lock + verify the trade. FOR UPDATE prevents a concurrent
    // confirm-cost from racing the rollback.
    const trade = await client.query(
      "SELECT status FROM trades WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [tradeId, userId]
    );
    if (trade.rows.length === 0) {
      throw Object.assign(new Error("Trade not found"), { httpStatus: 404 });
    }
    if (trade.rows[0].status !== "pending") {
      throw Object.assign(
        new Error(`Trade is ${trade.rows[0].status}, cannot cancel`),
        { httpStatus: 400 }
      );
    }

    // 1. Pull the per-side card ids so we know what to restore vs delete.
    const lineage = await client.query(
      `SELECT card_id, side FROM trade_cards WHERE trade_id = $1`,
      [tradeId]
    );
    const givenIds    = lineage.rows.filter((r) => r.side === "given").map((r) => r.card_id);
    const receivedIds = lineage.rows.filter((r) => r.side === "received").map((r) => r.card_id);

    // 2. Restore given cards to active. We don't blindly NULL the status
    //    — only flip rows whose status is currently 'traded' so we
    //    don't accidentally clobber some other status state if it ever
    //    grows beyond NULL/'traded'.
    if (givenIds.length > 0) {
      await client.query(
        `UPDATE cards SET status = NULL
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = 'traded'`,
        [userId, givenIds]
      );
    }

    // 3. Delete the received cards. trade_cards rows referencing them
    //    cascade-delete via the FK, so we have to drop the trade_cards
    //    rows BEFORE the cards rows would normally be the order — but
    //    the schema uses ON DELETE CASCADE on trade_cards.card_id so
    //    deleting a card auto-deletes its trade_cards row. We still
    //    need to handle the 'given' side trade_cards (which we don't
    //    want to cascade — the given cards aren't being deleted, just
    //    restored). Easier to delete trade_cards explicitly first.
    await client.query(
      "DELETE FROM trade_cards WHERE trade_id = $1",
      [tradeId]
    );

    // 4. Delete received cards. Restricted to ones belonging to this
    //    user with NULL my_cost as a safety net — if anything has
    //    populated my_cost between execute and cancel, we leave that
    //    row alone (defensive; should never happen in practice).
    if (receivedIds.length > 0) {
      await client.query(
        `DELETE FROM cards
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND my_cost IS NULL`,
        [userId, receivedIds]
      );
    }

    // 5. Drop the trade row itself.
    await client.query("DELETE FROM trades WHERE id = $1", [tradeId]);

    await client.query("COMMIT");
    return json(200, {
      ok: true,
      restored: givenIds.length,
      deleted:  receivedIds.length,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.httpStatus) return json(err.httpStatus, { error: err.message });
    console.error("Trade cancel failed:", err);
    return json(500, { error: "Trade cancel failed" });
  } finally {
    client.release();
  }
};
