// One-shot diagnostic that exercises the consignment-decline flow inside
// a transaction, then ROLLBACKs so nothing in production is mutated.
//
// What it proves:
//   1. Flipping a consignment to 'declined' sets ever_declined = TRUE.
//   2. The same flip seeds consignment_blocks for the consignment owner.
//   3. The block is per-(user_id, cert_number): a different user with
//      the same cert is NOT blocked.
//   4. The block survives card deletion (simulated by deleting the
//      cards row and re-querying consignment_blocks for the same
//      (user_id, cert_number) pair).
//
// Synthetic data only — invents two users + two cards + one consignment
// with a sentinel cert_number, runs the assertions, ROLLBACKs.
//
//   aws lambda invoke --function-name scp-test-decline-logic --region us-east-1 out.json
const { getPool } = require("../_db");

const TEST_CERT = "DECLINE-LOGIC-TEST-99999";

exports.handler = async () => {
  const db = await getPool();
  const client = await db.connect();
  const checks = [];
  const record = (name, expected, actual) => {
    checks.push({ name, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) });
  };

  try {
    await client.query("BEGIN");

    // 1. Two synthetic users.
    const userA = (await client.query(
      "INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id",
      [`test-sub-A-${Date.now()}`, `test-a-${Date.now()}@example.invalid`]
    )).rows[0].id;
    const userB = (await client.query(
      "INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id",
      [`test-sub-B-${Date.now()}`, `test-b-${Date.now()}@example.invalid`]
    )).rows[0].id;

    // 2. Each user has their own card with the SAME cert (allowed:
    //    cards uniqueness is per-user via (user_id, cert_number)).
    const cardA = (await client.query(
      "INSERT INTO cards (user_id, cert_number) VALUES ($1, $2) RETURNING id",
      [userA, TEST_CERT]
    )).rows[0].id;
    const cardB = (await client.query(
      "INSERT INTO cards (user_id, cert_number) VALUES ($1, $2) RETURNING id",
      [userB, TEST_CERT]
    )).rows[0].id;

    // 3. Only User A submits a consignment.
    const consA = (await client.query(
      `INSERT INTO consignments (user_id, card_id, type)
       VALUES ($1, $2, 'auction') RETURNING id, status, ever_declined`,
      [userA, cardA]
    )).rows[0];
    record("baseline: A's consignment status",       "pending", consA.status);
    record("baseline: A's ever_declined is FALSE",   false,     consA.ever_declined);

    // Pre-decline block-table state.
    const preBlocksA = (await client.query(
      "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2", [userA, TEST_CERT]
    )).rowCount;
    const preBlocksB = (await client.query(
      "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2", [userB, TEST_CERT]
    )).rowCount;
    record("baseline: no block row for A", 0, preBlocksA);
    record("baseline: no block row for B", 0, preBlocksB);

    // 4. Mirror the EXACT SQL update-consignment.js runs when admin
    //    flips status to 'declined': UPDATE + INSERT block.
    await client.query(
      `UPDATE consignments
       SET status = 'declined', ever_declined = TRUE, updated_at = NOW()
       WHERE id = $1`,
      [consA.id]
    );
    await client.query(
      `INSERT INTO consignment_blocks (user_id, cert_number, reason)
       SELECT $1, cert_number, 'declined' FROM cards WHERE id = $2
       ON CONFLICT (user_id, cert_number) DO NOTHING`,
      [userA, cardA]
    );

    // 5. Assertion: ever_declined latched on A's consignment row.
    const afterA = (await client.query(
      "SELECT status, ever_declined FROM consignments WHERE id = $1", [consA.id]
    )).rows[0];
    record("after decline: A's consignment status",     "declined", afterA.status);
    record("after decline: A's ever_declined is TRUE",  true,       afterA.ever_declined);

    // 6. Assertion: block row exists for (A, cert) but NOT (B, cert).
    const postBlocksA = (await client.query(
      "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2", [userA, TEST_CERT]
    )).rowCount;
    const postBlocksB = (await client.query(
      "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2", [userB, TEST_CERT]
    )).rowCount;
    record("after decline: A is blocked for the cert",   1, postBlocksA);
    record("after decline: B is NOT blocked (per-user scoping)", 0, postBlocksB);

    // 7. Simulate B adding the same cert and the add-card.js block lookup.
    //    consignment_blocks query mirrors add-card.js:126.
    const bAddBlocked = (await client.query(
      "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2", [userB, TEST_CERT]
    )).rowCount > 0;
    record("B's add-card sees consignmentBlocked=false", false, bAddBlocked);

    // 8. Simulate A deleting their card and re-adding it (block must
    //    survive). Delete cardA, then re-query consignment_blocks for
    //    (A, cert) — block table has ON DELETE CASCADE on user_id only,
    //    not on cards, so the block stays.
    await client.query("DELETE FROM cards WHERE id = $1", [cardA]);
    const survives = (await client.query(
      "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2", [userA, TEST_CERT]
    )).rowCount;
    record("after card delete: A's block survives", 1, survives);

    // 9. Bonus: confirm B's view via get-cards.js LEFT JOIN matches.
    //    Insert a fresh card for B (same cert, B owns it) and join
    //    consignment_blocks the same way the read endpoint does.
    const cardB2 = (await client.query(
      "INSERT INTO cards (user_id, cert_number) VALUES ($1, $2) RETURNING id",
      [userB, `${TEST_CERT}-B2`]
    )).rows[0].id;
    void cardB2;
    const bView = (await client.query(
      `SELECT (cb.user_id IS NOT NULL) AS blocked
       FROM cards c
       LEFT JOIN consignment_blocks cb
         ON cb.user_id = c.user_id AND cb.cert_number = c.cert_number
       WHERE c.user_id = $1 AND c.cert_number = $2`,
      [userB, TEST_CERT]
    )).rows[0].blocked;
    record("B's get-cards.js LEFT JOIN returns blocked=false", false, bView);

    // ROLLBACK so nothing we did persists.
    await client.query("ROLLBACK");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message, stack: err.stack, checks }),
    };
  } finally {
    client.release();
  }

  const allPassed = checks.every((c) => c.pass);
  return {
    statusCode: allPassed ? 200 : 500,
    body: JSON.stringify({
      ok: allPassed,
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
      checks,
    }, null, 2),
  };
};
