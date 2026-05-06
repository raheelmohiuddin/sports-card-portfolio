const { getPool, ensureUser } = require("../_db");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({});

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const cardId = event.pathParameters?.id;
  if (!cardId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Card id is required" }) };
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Fetch the card to confirm ownership and get S3 key
  const existing = await db.query(
    "SELECT id, s3_image_key FROM cards WHERE id = $1 AND user_id = $2",
    [cardId, userId]
  );

  if (existing.rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: "Card not found" }) };
  }

  const { s3_image_key } = existing.rows[0];

  await db.query("DELETE FROM cards WHERE id = $1", [cardId]);

  if (s3_image_key) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.CARD_IMAGES_BUCKET,
        Key: s3_image_key,
      })
    );
  }

  return { statusCode: 204, body: "" };
};
