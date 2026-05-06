const { getPool, ensureUser } = require("../_db");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({});

async function signedUrl(key) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.CARD_IMAGES_BUCKET, Key: key }),
    { expiresIn: 3600 }
  );
}

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, cert_number, year, brand, sport, player_name, card_number,
            grade, grade_description,
            s3_image_key, image_url,
            s3_back_image_key, back_image_url,
            estimated_value, added_at
     FROM cards
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [userId]
  );

  const cards = await Promise.all(
    result.rows.map(async (row) => {
      // S3 user-upload takes priority over stored PSA CDN URL for both sides
      const [imageUrl, backImageUrl] = await Promise.all([
        row.s3_image_key  ? signedUrl(row.s3_image_key)       : Promise.resolve(row.image_url      ?? null),
        row.s3_back_image_key ? signedUrl(row.s3_back_image_key) : Promise.resolve(row.back_image_url ?? null),
      ]);

      return {
        id: row.id,
        certNumber: row.cert_number,
        year: row.year,
        brand: row.brand,
        sport: row.sport,
        playerName: row.player_name,
        cardNumber: row.card_number,
        grade: row.grade,
        gradeDescription: row.grade_description,
        estimatedValue: row.estimated_value ? parseFloat(row.estimated_value) : null,
        imageUrl,
        backImageUrl,
        addedAt: row.added_at,
      };
    })
  );

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cards),
  };
};
