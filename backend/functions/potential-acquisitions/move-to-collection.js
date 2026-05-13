// POST /potential-acquisitions/{id}/move
// Atomic transfer from potential_acquisitions to cards. Body carries
// the cost basis (and optional sell target) the user is recording at
// acquisition time.
//
// Per OQ-2 locked: PA's added_at is preserved on the new card row as
// `wanted_since` (cards column added in migration 0005). Surfaces only
// in CardModal sidebar; not on the tile.
//
// Per OQ-7 (commit 1b): cards.sell_target_price replaces target_price.
// Body field name is sellTargetPrice (camelCase, new contract — no
// existing frontend caller predates this).
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidPrice } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const paId = event.pathParameters?.id;
  if (!isValidId(paId)) return json(400, { error: "Invalid PA id" });

  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { myCost, sellTargetPrice } = body;

  // Both fields optional. The user might know the cost but not yet
  // care about a sell target — allow either to be omitted.
  const costProvided = myCost !== null && myCost !== undefined && myCost !== "";
  if (costProvided && !isValidPrice(myCost)) {
    return json(400, { error: "myCost must be a non-negative number under 10,000,000" });
  }
  const myCostValue = costProvided ? parseFloat(myCost) : null;

  const targetProvided = sellTargetPrice !== null && sellTargetPrice !== undefined && sellTargetPrice !== "";
  if (targetProvided && !isValidPrice(sellTargetPrice)) {
    return json(400, { error: "sellTargetPrice must be a non-negative number under 10,000,000" });
  }
  const sellTargetValue = targetProvided ? parseFloat(sellTargetPrice) : null;

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Verify PA exists and is owned by the caller before transferring.
    const paRow = await client.query(
      "SELECT id FROM potential_acquisitions WHERE id = $1 AND user_id = $2",
      [paId, userId]
    );
    if (paRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return json(404, { error: "PA not found" });
    }

    // INSERT via SELECT from the PA row — copies every shared column.
    // ON CONFLICT (user_id, cert_number) DO NOTHING handles the rare
    // case where the user already has this cert in cards (race or
    // direct DB write); we return 409 in that case.
    const insertResult = await client.query(
      `INSERT INTO cards
         (user_id, cert_number, grader, year, brand, sport, category, player_name,
          card_number, grade, grade_description, variant,
          psa_population, psa_population_higher,
          my_cost, sell_target_price,
          image_url, back_image_url, s3_image_key, s3_back_image_key,
          estimated_value, avg_sale_price, last_sale_price, num_sales,
          price_source, value_last_updated,
          cardhedger_id, cardhedger_image_url, raw_comps,
          estimate_price, estimate_price_low, estimate_price_high,
          estimate_confidence, estimate_method,
          estimate_freshness_days, estimate_last_updated,
          wanted_since)
       SELECT
          user_id, cert_number, grader, year, brand, sport, category, player_name,
          card_number, grade, grade_description, variant,
          psa_population, psa_population_higher,
          $1, $2,
          image_url, back_image_url, s3_image_key, s3_back_image_key,
          estimated_value, avg_sale_price, last_sale_price, num_sales,
          price_source, value_last_updated,
          cardhedger_id, cardhedger_image_url, raw_comps,
          estimate_price, estimate_price_low, estimate_price_high,
          estimate_confidence, estimate_method,
          estimate_freshness_days, estimate_last_updated,
          added_at
       FROM potential_acquisitions
       WHERE id = $3 AND user_id = $4
       ON CONFLICT (user_id, cert_number) DO NOTHING
       RETURNING id`,
      [myCostValue, sellTargetValue, paId, userId]
    );

    if (insertResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return json(409, {
        error: "This cert is already in your collection",
      });
    }

    const newCardId = insertResult.rows[0].id;

    await client.query(
      "DELETE FROM potential_acquisitions WHERE id = $1 AND user_id = $2",
      [paId, userId]
    );

    await client.query("COMMIT");

    return json(200, {
      newCardId,
      removedPaId: paId,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};
