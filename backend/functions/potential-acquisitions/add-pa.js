// POST /potential-acquisitions
// Creates a PA row from a cert lookup + optional buy_target_price.
// Mirrors add-card.js: validates body, INSERT ON CONFLICT DO NOTHING,
// then fires fetchValuation to populate estimate_price + raw_comps.
//
// Per OQ-8 locked: supports optional front + back image upload (same
// UX as add-card — two DropZones, both optional). Falls back to
// cardhedger_image_url on tile render when no user image present.
//
// Note: ON CONFLICT clause includes WHERE cert_number IS NOT NULL to
// match the partial unique index from migration 0005. cert_number is
// guaranteed non-null at INSERT time by isValidCertNumber above, so the
// predicate always holds.
const { getPool, ensureUser } = require("../_db");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");
const { isValidCertNumber, sanitize, isHttpsUrl, isValidPrice, isValidCount } = require("../_validate");
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
    psaPopulation, psaPopulationHigher,
    buyTargetPrice, notes, priority,
    hasFrontImage, hasBackImage,
    grader,
  } = body;

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
  const targetProvided = buyTargetPrice !== null && buyTargetPrice !== undefined && buyTargetPrice !== "";
  if (targetProvided && !isValidPrice(buyTargetPrice)) {
    return json(400, { error: "buyTargetPrice must be a non-negative number under 10,000,000" });
  }
  const buyTargetValue = targetProvided ? parseFloat(buyTargetPrice) : null;

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `INSERT INTO potential_acquisitions
       (user_id, cert_number, grader, year, brand, sport, category, player_name,
        card_number, grade, grade_description, psa_population, psa_population_higher,
        buy_target_price, notes, priority,
        image_url, back_image_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (user_id, cert_number) WHERE cert_number IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      userId,
      certNumber.trim(),
      graderValue,
      sanitize(year, 10),
      sanitize(brand, 200),
      sanitize(sport, 100),
      sanitize(category, 100),
      sanitize(playerName, 300),
      sanitize(cardNumber, 100),
      sanitize(grade, 10),
      sanitize(gradeDescription, 200),
      psaPopulation       != null ? parseInt(psaPopulation, 10)       : null,
      psaPopulationHigher != null ? parseInt(psaPopulationHigher, 10) : null,
      buyTargetValue,
      sanitize(notes, 2000),
      sanitize(priority, 20),
      frontImageUrl ?? null,
      backImageUrl  ?? null,
    ]
  );

  if (result.rows.length === 0) {
    const existing = await db.query(
      "SELECT id FROM potential_acquisitions WHERE user_id = $1 AND cert_number = $2",
      [userId, certNumber.trim()]
    );
    return json(409, {
      error: "This card is already in your Potential Acquisitions list",
      existingPaId: existing.rows[0]?.id ?? null,
    });
  }

  const paId = result.rows[0].id;
  const bucket = process.env.CARD_IMAGES_BUCKET;
  // Mirror add-card.js: only generate S3 keys for sides the client said
  // it'll upload. Avoids s3_image_key pointing at a non-existent object.
  const frontKey = hasFrontImage ? `pa/${userId}/${paId}-front.jpg` : null;
  const backKey  = hasBackImage  ? `pa/${userId}/${paId}-back.jpg`  : null;

  const [frontUploadUrl, backUploadUrl] = await Promise.all([
    frontKey ? makeUploadUrl(bucket, frontKey) : Promise.resolve(null),
    backKey  ? makeUploadUrl(bucket, backKey)  : Promise.resolve(null),
  ]);

  if (frontKey || backKey) {
    await db.query(
      "UPDATE potential_acquisitions SET s3_image_key = $1, s3_back_image_key = $2 WHERE id = $3",
      [frontKey, backKey, paId]
    );
  }

  // Synchronous valuation — best-effort. The PA row is already
  // INSERTed; if this fails, refresh-portfolio.js's PA loop (72h
  // staleness gate per OQ-5) picks it up later.
  const valuation = await fetchValuation({
    certNumber,
    grader: graderValue,
    grade,
  }).catch((err) => {
    console.warn("[add-pa] valuation fetch failed:", err.message);
    return null;
  });

  if (valuation) {
    await db.query(
      `UPDATE potential_acquisitions SET
         estimated_value         = COALESCE($1, estimated_value),
         avg_sale_price          = $1,
         last_sale_price         = $2,
         num_sales               = $3,
         price_source            = 'cardhedger',
         cardhedger_id           = $4,
         cardhedger_image_url    = COALESCE($5, cardhedger_image_url),
         raw_comps               = $6,
         value_last_updated      = NOW(),
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
        paId,
      ]
    );
  }

  return json(201, {
    id: paId,
    frontUploadUrl,
    backUploadUrl,
  });
};
