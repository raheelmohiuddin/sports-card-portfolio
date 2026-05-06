const { getPool, ensureUser } = require("../_db");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { json, noContent } = require("../_response");
const { isValidId } = require("../_validate");

const s3 = new S3Client({});

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const existing = await db.query(
    "SELECT id, s3_image_key, s3_back_image_key FROM cards WHERE id = $1 AND user_id = $2",
    [cardId, userId]
  );
  if (existing.rows.length === 0) return json(404, { error: "Card not found" });

  const { s3_image_key, s3_back_image_key } = existing.rows[0];
  await db.query("DELETE FROM cards WHERE id = $1", [cardId]);

  const bucket = process.env.CARD_IMAGES_BUCKET;
  const deletes = [];
  if (s3_image_key)      deletes.push(s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3_image_key })));
  if (s3_back_image_key) deletes.push(s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3_back_image_key })));
  await Promise.allSettled(deletes);

  return noContent();
};
