const { getPool, ensureUser } = require("../_db");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");
const { isValidCertNumber, sanitize, isHttpsUrl, isValidCount } = require("../_validate");

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
    certNumber, year, brand, sport, playerName, cardNumber,
    grade, gradeDescription, frontImageUrl, backImageUrl,
    psaPopulation, psaPopulationHigher, psaData,
  } = body;

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

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `INSERT INTO cards
       (user_id, cert_number, year, brand, sport, player_name, card_number,
        grade, grade_description, image_url, back_image_url,
        psa_population, psa_population_higher, psa_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (user_id, cert_number) DO UPDATE
       SET year                  = EXCLUDED.year,
           brand                 = EXCLUDED.brand,
           sport                 = EXCLUDED.sport,
           player_name           = EXCLUDED.player_name,
           grade                 = EXCLUDED.grade,
           grade_description     = EXCLUDED.grade_description,
           image_url             = EXCLUDED.image_url,
           back_image_url        = EXCLUDED.back_image_url,
           psa_population        = EXCLUDED.psa_population,
           psa_population_higher = EXCLUDED.psa_population_higher,
           psa_data              = EXCLUDED.psa_data
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
    ]
  );

  const cardId = result.rows[0].id;
  const bucket = process.env.CARD_IMAGES_BUCKET;
  const frontKey = `cards/${userId}/${cardId}-front.jpg`;
  const backKey  = `cards/${userId}/${cardId}-back.jpg`;

  const [frontUploadUrl, backUploadUrl] = await Promise.all([
    makeUploadUrl(bucket, frontKey),
    makeUploadUrl(bucket, backKey),
  ]);

  await db.query(
    "UPDATE cards SET s3_image_key = $1, s3_back_image_key = $2 WHERE id = $3",
    [frontKey, backKey, cardId]
  );

  return json(201, { id: cardId, frontUploadUrl, backUploadUrl });
};
