const { getPool, ensureUser } = require("../_db");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");
const { isValidCertNumber, sanitize, isHttpsUrl, isValidCount, isValidPrice } = require("../_validate");
const { fetchValuation } = require("../portfolio/pricing");

const s3 = new S3Client({});

async function makeUploadUrl(bucket, key) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/jpeg" }),
    { expiresIn: 300 }
  );
}

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const {
    certNumber, year, brand, sport, category, playerName, cardNumber,
    grade, gradeDescription, frontImageUrl, backImageUrl,
    psaPopulation, psaPopulationHigher, psaData,
    myCost, sellTargetPrice,
    hasFrontImage, hasBackImage,
    grader,
  } = body;
  // Default to PSA when the field is missing — preserves the contract
  // for any older client that doesn't yet know about graders.
  const graderValue = ["PSA", "BGS", "SGC"].includes(grader) ? grader : "PSA";

  if (!isValidCertNumber(certNumber)) {
    return json(400, { error: "certNumber is required and must be 1–30 alphanumeric characters" });
  }
  if (frontImageUrl != null && !isHttpsUrl(frontImageUrl)) {
    return json(400, { error: "frontImageUrl must be a valid HTTPS URL" });
  }
  if (backImageUrl != null && !isHttpsUrl(backImageUrl)) {
    return json(400, { error: "backImageUrl must be a valid HTTPS URL" });
  }
  if (!isValidCount(psaPopulation) || !isValidCount(psaPopulationHigher)) {
    return json(400, { error: "psaPopulation values must be non-negative integers" });
  }
  // myCost is optional; null/undefined/empty are all acceptable.
  const costProvided = myCost !== null && myCost !== undefined && myCost !== "";
  if (costProvided && !isValidPrice(myCost)) {
    return json(400, { error: "myCost must be a non-negative number under 10,000,000" });
  }
  const myCostValue = costProvided ? parseFloat(myCost) : null;

  const targetProvided = sellTargetPrice !== null && sellTargetPrice !== undefined && sellTargetPrice !== "";
  if (targetProvided && !isValidPrice(sellTargetPrice)) {
    return json(400, { error: "sellTargetPrice must be a non-negative number under 10,000,000" });
  }
  const sellTargetPriceValue = targetProvided ? parseFloat(sellTargetPrice) : null;

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Per OQ-6 + OQ-11 of .agents/potential-acquisitions-plan.md: run
  // fetchValuation BEFORE the INSERT so the resulting cardhedger_id can
  // power a cross-bucket duplicate-detection query against the user's
  // potential_acquisitions list. On CardHedger outage the catch returns
  // null and we fall back to cert-only matching (the $2 IS NULL path of
  // the OR clause below). The valuation result is cached and reused by
  // the post-INSERT UPDATE — fetchValuation never runs twice per add.
  const valuation = await fetchValuation({
    certNumber,
    grader: graderValue,
    grade,
  }).catch((err) => {
    console.warn("[add-card] valuation fetch failed:", err.message);
    return null;
  });

  // PA-detection match query (per OQ-6 locked). If the user already has
  // this card in their Potential Acquisitions list, return a special
  // response shape so the frontend can offer a confirmation modal to
  // move the PA row to cards instead of creating a fresh cards row.
  const paMatch = await db.query(
    `SELECT id, cert_number, year, brand, player_name, grade, added_at
     FROM potential_acquisitions
     WHERE user_id = $1
       AND ( (cardhedger_id IS NOT NULL AND cardhedger_id = $2)
             OR ((cardhedger_id IS NULL OR $2 IS NULL) AND cert_number = $3) )
     LIMIT 1`,
    [userId, valuation?.cardhedgerId ?? null, certNumber.trim()]
  );

  if (paMatch.rowCount > 0) {
    const pa = paMatch.rows[0];
    return json(200, {
      status:    "pa_match_found",
      paId:      pa.id,
      paDetails: {
        year:       pa.year,
        brand:      pa.brand,
        playerName: pa.player_name,
        grade:      pa.grade,
        addedAt:    pa.added_at,
      },
    });
  }

  // Atomic duplicate check: ON CONFLICT DO NOTHING + RETURNING. If the cert
  // already exists for this user we get 0 rows back and bail with a 409.
  const result = await db.query(
    `INSERT INTO cards
       (user_id, cert_number, year, brand, sport, player_name, card_number,
        grade, grade_description, image_url, back_image_url,
        psa_population, psa_population_higher, psa_data, my_cost, sell_target_price,
        grader, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (user_id, cert_number) DO NOTHING
     RETURNING id`,
    [
      userId,
      certNumber.trim(),
      sanitize(year, 10),
      sanitize(brand, 200),
      sanitize(sport, 100),
      sanitize(playerName, 300),
      sanitize(cardNumber, 100),
      sanitize(grade, 10),
      sanitize(gradeDescription, 200),
      frontImageUrl ?? null,
      backImageUrl  ?? null,
      psaPopulation        != null ? parseInt(psaPopulation, 10)       : null,
      psaPopulationHigher  != null ? parseInt(psaPopulationHigher, 10) : null,
      psaData ? JSON.stringify(psaData) : null,
      myCostValue,
      sellTargetPriceValue,
      graderValue,
      // Client may send category from the lookup-preview response; the
      // authoritative CardHedger value is written by the valuation
      // UPDATE below using COALESCE so this stays as a fallback.
      sanitize(category, 100),
    ]
  );

  if (result.rows.length === 0) {
    // Duplicate cert in this user's portfolio — fetch the existing id so the
    // frontend can deep-link the user to the card they already own.
    const existing = await db.query(
      "SELECT id FROM cards WHERE user_id = $1 AND cert_number = $2",
      [userId, certNumber.trim()]
    );
    return json(409, {
      error: "This card is already in your portfolio",
      existingCardId: existing.rows[0]?.id ?? null,
    });
  }

  const cardId = result.rows[0].id;
  const bucket = process.env.CARD_IMAGES_BUCKET;
  // Only generate pre-signed URLs and persist s3 keys for sides that will
  // actually be uploaded. Otherwise get-cards.js sees an s3_image_key
  // pointing at a non-existent S3 object, which short-circuits the
  // image_url fallback and produces a brief broken-image flash before
  // the placeholder kicks in.
  const frontKey = hasFrontImage ? `cards/${userId}/${cardId}-front.jpg` : null;
  const backKey  = hasBackImage  ? `cards/${userId}/${cardId}-back.jpg`  : null;

  const [frontUploadUrl, backUploadUrl] = await Promise.all([
    frontKey ? makeUploadUrl(bucket, frontKey) : Promise.resolve(null),
    backKey  ? makeUploadUrl(bucket, backKey)  : Promise.resolve(null),
  ]);

  if (frontKey || backKey) {
    await db.query(
      "UPDATE cards SET s3_image_key = $1, s3_back_image_key = $2 WHERE id = $3",
      [frontKey, backKey, cardId]
    );
  }

  // Valuation was already fetched pre-INSERT for the OQ-6 PA-detection
  // branch above; reuse the cached `valuation` here without a second call.
  if (valuation) {
    await db.query(
      `UPDATE cards SET
         estimated_value      = COALESCE($1, estimated_value),
         avg_sale_price       = $1,
         last_sale_price      = $2,
         num_sales            = $3,
         price_source         = 'cardhedger',
         cardhedger_id        = $4,
         cardhedger_image_url = COALESCE($5, cardhedger_image_url),
         raw_comps            = $6,
         value_last_updated   = NOW(),
         estimate_price          = $7,
         estimate_price_low      = $8,
         estimate_price_high     = $9,
         estimate_confidence     = $10,
         estimate_method         = $11,
         estimate_freshness_days = $12,
         estimate_last_updated   = NOW(),
         variant                 = COALESCE($13, variant),
         category                = COALESCE($14, category)
       WHERE id = $15`,
      [
        valuation.comps?.avgSalePrice  ?? null,
        valuation.comps?.lastSalePrice ?? null,
        valuation.comps?.numSales      ?? 0,
        valuation.cardhedgerId         ?? null,
        valuation.cardhedgerImageUrl   ?? null,
        JSON.stringify(valuation.comps?.rawComps ?? []),
        valuation.estimate?.price          ?? null,
        valuation.estimate?.priceLow       ?? null,
        valuation.estimate?.priceHigh      ?? null,
        valuation.estimate?.confidence     ?? null,
        valuation.estimate?.method         ?? null,
        valuation.estimate?.freshnessDays  ?? null,
        valuation.variant                  ?? null,
        valuation.category                 ?? null,
        cardId,
      ]
    );
  }

  // Permanent consignment block lookup — if this user ever had a
  // consignment for this cert declined, the block survived the original
  // card being deleted. Surfaced so the frontend can render the blocked
  // message immediately on re-add without a round-trip through getCards.
  const blockRow = await db.query(
    "SELECT 1 FROM consignment_blocks WHERE user_id = $1 AND cert_number = $2",
    [userId, certNumber.trim()]
  );

  return json(201, {
    id: cardId,
    frontUploadUrl,
    backUploadUrl,
    consignmentBlocked: blockRow.rowCount > 0,
  });
};
