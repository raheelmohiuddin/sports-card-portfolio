// Shared S3 presigner. Card-image read URLs are identical across get-cards,
// get-card, and admin/get-card — same bucket (CARD_IMAGES_BUCKET), same TTL.
// Avatar and PUT presigners stay inline in their callers because they use
// different buckets/operations/TTLs.
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({});

async function signedCardImageUrl(key) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.CARD_IMAGES_BUCKET, Key: key }),
    { expiresIn: 3600 }
  );
}

module.exports = { signedCardImageUrl };
