const { getPool, ensureUser } = require("../_db");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

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
  if (!claims) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const {
    certNumber, year, brand, sport, playerName, cardNumber,
    grade, gradeDescription, frontImageUrl, backImageUrl, psaData,
  } = body;

  if (!certNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "certNumber is required" }) };
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `INSERT INTO cards
       (user_id, cert_number, year, brand, sport, player_name, card_number,
        grade, grade_description, image_url, back_image_url, psa_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id, cert_number) DO UPDATE
       SET year              = EXCLUDED.year,
           brand             = EXCLUDED.brand,
           sport             = EXCLUDED.sport,
           player_name       = EXCLUDED.player_name,
           grade             = EXCLUDED.grade,
           grade_description = EXCLUDED.grade_description,
           image_url         = EXCLUDED.image_url,
           back_image_url    = EXCLUDED.back_image_url,
           psa_data          = EXCLUDED.psa_data
     RETURNING id`,
    [
      userId, certNumber, year, brand, sport, playerName, cardNumber,
      grade, gradeDescription,
      frontImageUrl ?? null,
      backImageUrl ?? null,
      psaData ? JSON.stringify(psaData) : null,
    ]
  );

  const cardId = result.rows[0].id;
  const bucket = process.env.CARD_IMAGES_BUCKET;
  const frontKey = `cards/${userId}/${cardId}-front.jpg`;
  const backKey  = `cards/${userId}/${cardId}-back.jpg`;

  // Generate both upload URLs concurrently
  const [frontUploadUrl, backUploadUrl] = await Promise.all([
    makeUploadUrl(bucket, frontKey),
    makeUploadUrl(bucket, backKey),
  ]);

  await db.query(
    "UPDATE cards SET s3_image_key = $1, s3_back_image_key = $2 WHERE id = $3",
    [frontKey, backKey, cardId]
  );

  return {
    statusCode: 201,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: cardId, frontUploadUrl, backUploadUrl }),
  };
};
