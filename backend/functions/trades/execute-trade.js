// POST /trades/execute — record a trade and shuffle inventory.
//
// Atomic across four operations:
//   1. mark every cardsGiven row as status='traded'
//   2. INSERT each cardsReceived row into cards (with my_cost = NULL —
//      cost basis is allocated later via /trades/confirm-cost)
//   3. INSERT a trades row in 'pending' status
//   4. INSERT one trade_cards row per side, snapshotting metadata so
//      trade history survives later edits
//
// Wrapped in BEGIN/COMMIT/ROLLBACK on a checked-out client. Any error
// (foreign-key, duplicate cert, ownership mismatch) rolls everything
// back — partial trades are never persisted.
//
// Body shape:
//   { cardsGiven:    [card_id, ...],
//     cardsReceived: [{ certNumber, playerName, year, brand, grade,
//                       sport?, cardNumber?, gradeDescription?,
//                       frontImageUrl?, backImageUrl?,
//                       psaPopulation?, psaPopulationHigher?, psaData? }, ...],
//     cashGiven:    number (>= 0),
//     cashReceived: number (>= 0),
//     notes?:       string }
//
// Returns: { tradeId, receivedCards: [{ id, certNumber }, ...] }
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidCertNumber, sanitize, isValidPrice } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const cardsGiven    = Array.isArray(body.cardsGiven)    ? body.cardsGiven    : [];
  const cardsReceived = Array.isArray(body.cardsReceived) ? body.cardsReceived : [];
  const cashGiven     = body.cashGiven    ?? 0;
  const cashReceived  = body.cashReceived ?? 0;
  const notes         = body.notes ?? null;

  if (cardsGiven.length === 0 && cardsReceived.length === 0) {
    return json(400, { error: "Trade must include at least one card on either side" });
  }
  if (cardsGiven.some((id) => !isValidId(id))) {
    return json(400, { error: "Invalid card id in cardsGiven" });
  }
  for (const c of cardsReceived) {
    if (!c || !isValidCertNumber(c.certNumber)) {
      return json(400, { error: "Invalid certNumber in cardsReceived" });
    }
    // estimatedValue is optional; null/undefined are fine. When provided it
    // must be a finite, non-negative number — that's the trade-time price
    // from /pricing/preview that the user saw in the builder.
    if (c.estimatedValue != null) {
      const v = Number(c.estimatedValue);
      if (!Number.isFinite(v) || v < 0) {
        return json(400, { error: "estimatedValue must be a non-negative number" });
      }
    }
  }
  if (!isValidPrice(cashGiven) || !isValidPrice(cashReceived)) {
    return json(400, { error: "cashGiven and cashReceived must be non-negative numbers" });
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Per-trade transaction. db.connect() checks out a single client so all
  // four operations land on the same connection — required for BEGIN/COMMIT.
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Verify ownership AND active status of every given card up front.
    //    If any are missing or already traded, we bail before touching state.
    if (cardsGiven.length > 0) {
      const verify = await client.query(
        `SELECT id FROM cards
         WHERE user_id = $1 AND id = ANY($2::uuid[])
           AND (status IS NULL OR status <> 'traded')`,
        [userId, cardsGiven]
      );
      if (verify.rows.length !== cardsGiven.length) {
        throw Object.assign(
          new Error("Some given cards are missing, already traded, or not yours"),
          { httpStatus: 400 }
        );
      }
    }

    // 2. Insert received cards. ON CONFLICT (user_id, cert_number) DO NOTHING
    //    means a duplicate cert returns 0 rows — we treat that as a hard
    //    rejection so the user knows they can't trade for a card they
    //    already own.
    const receivedCardIds = [];
    for (const r of cardsReceived) {
      const ins = await client.query(
        `INSERT INTO cards
           (user_id, cert_number, year, brand, sport, player_name, card_number,
            grade, grade_description, image_url, back_image_url,
            psa_population, psa_population_higher, psa_data, my_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (user_id, cert_number) DO NOTHING
         RETURNING id`,
        [
          userId,
          r.certNumber.trim(),
          sanitize(r.year, 10),
          sanitize(r.brand, 200),
          sanitize(r.sport ?? null, 100),
          sanitize(r.playerName, 300),
          sanitize(r.cardNumber ?? null, 100),
          sanitize(r.grade, 10),
          sanitize(r.gradeDescription ?? null, 200),
          r.frontImageUrl ?? null,
          r.backImageUrl  ?? null,
          r.psaPopulation       != null ? parseInt(r.psaPopulation, 10)       : null,
          r.psaPopulationHigher != null ? parseInt(r.psaPopulationHigher, 10) : null,
          r.psaData ? JSON.stringify(r.psaData) : null,
          null, // my_cost — allocated by /trades/confirm-cost
        ]
      );
      if (ins.rows.length === 0) {
        throw Object.assign(
          new Error(`Cert ${r.certNumber} is already in your portfolio`),
          { httpStatus: 409 }
        );
      }
      receivedCardIds.push({ id: ins.rows[0].id, certNumber: r.certNumber });
    }

    // 3. Mark given cards as traded. Done after received-card inserts so
    //    a duplicate-cert failure doesn't leave the user with cards that
    //    were marked traded against a rolled-back transaction.
    if (cardsGiven.length > 0) {
      await client.query(
        `UPDATE cards SET status = 'traded'
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, cardsGiven]
      );
    }

    // 4. Create the trade row in 'pending' status.
    const tradeIns = await client.query(
      `INSERT INTO trades (user_id, cash_given, cash_received, notes, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [userId, cashGiven, cashReceived, notes]
    );
    const tradeId = tradeIns.rows[0].id;

    // 5. Snapshot metadata into trade_cards. Batched per side via unnest()
    //    parallel arrays — one query per side instead of N. Given side gets
    //    a copy of my_cost (for trade-history accounting); received side
    //    stays NULL until confirm-cost.
    if (cardsGiven.length > 0) {
      const givenRows = await client.query(
        `SELECT id, cert_number, player_name, year, brand, grade,
                estimated_value, my_cost
         FROM cards WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, cardsGiven]
      );
      const g = givenRows.rows;
      await client.query(
        `INSERT INTO trade_cards
           (trade_id, card_id, side, cert_number, player_name, year, brand,
            grade, estimated_value, allocated_cost)
         SELECT $1, card_id, 'given', cert_number, player_name, year, brand,
                grade, estimated_value, allocated_cost
         FROM unnest(
           $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::text[], $8::numeric[], $9::numeric[]
         ) AS t(card_id, cert_number, player_name, year, brand, grade,
                estimated_value, allocated_cost)`,
        [
          tradeId,
          g.map((c) => c.id),
          g.map((c) => c.cert_number),
          g.map((c) => c.player_name),
          g.map((c) => c.year),
          g.map((c) => c.brand),
          g.map((c) => c.grade),
          g.map((c) => c.estimated_value),
          g.map((c) => c.my_cost),
        ]
      );
    }
    if (cardsReceived.length > 0) {
      await client.query(
        `INSERT INTO trade_cards
           (trade_id, card_id, side, cert_number, player_name, year, brand,
            grade, estimated_value, allocated_cost)
         SELECT $1, card_id, 'received', cert_number, player_name, year, brand,
                grade, estimated_value, NULL
         FROM unnest(
           $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::text[], $8::numeric[]
         ) AS t(card_id, cert_number, player_name, year, brand, grade,
                estimated_value)`,
        [
          tradeId,
          receivedCardIds.map((rc) => rc.id),
          cardsReceived.map((r) => r.certNumber.trim()),
          cardsReceived.map((r) => sanitize(r.playerName, 300)),
          cardsReceived.map((r) => sanitize(r.year, 10)),
          cardsReceived.map((r) => sanitize(r.brand, 200)),
          cardsReceived.map((r) => sanitize(r.grade, 10)),
          cardsReceived.map((r) => r.estimatedValue != null ? Number(r.estimatedValue) : null),
        ]
      );
    }

    await client.query("COMMIT");
    return json(200, { tradeId, receivedCards: receivedCardIds });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.httpStatus) return json(err.httpStatus, { error: err.message });
    console.error("Trade execute failed:", err);
    return json(500, { error: "Trade execute failed" });
  } finally {
    client.release();
  }
};
