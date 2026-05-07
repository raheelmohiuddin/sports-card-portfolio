const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");

const s3 = new S3Client({});

// Returns a presigned PUT URL the client uses to upload an avatar directly to
// S3, plus the S3 key the client should save into the user's Cognito `picture`
// attribute. We accept the contentType from the client so the URL is signed
// for the exact MIME type the upload will send.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body = {};
  try { body = JSON.parse(event.body ?? "{}"); } catch { /* fine */ }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const contentType = allowedTypes.includes(body.contentType) ? body.contentType : "image/jpeg";

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  // Random suffix on the key prevents browser-cache from showing the old
  // image after a fresh upload.
  const rand = Math.random().toString(36).slice(2, 10);
  const key  = `avatars/${claims.sub}/${Date.now().toString(36)}-${rand}.${ext}`;

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: process.env.CARD_IMAGES_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 }
  );

  return json(200, { uploadUrl: url, key, contentType });
};
