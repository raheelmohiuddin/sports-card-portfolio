const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");

const s3 = new S3Client({});

// Returns a fresh presigned GET URL for the user's avatar. We only sign keys
// that live inside the caller's own avatars/{sub}/ prefix — prevents one user
// asking for a signed URL to another user's S3 object.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const key = event.queryStringParameters?.key;
  if (!key) return json(400, { error: "key query parameter is required" });

  const expectedPrefix = `avatars/${claims.sub}/`;
  if (!key.startsWith(expectedPrefix)) {
    return json(403, { error: "Forbidden — key does not match caller" });
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.CARD_IMAGES_BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 }
  );

  return json(200, { viewUrl: url });
};
