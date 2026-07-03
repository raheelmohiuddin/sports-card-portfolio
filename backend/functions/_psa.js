// Shared PSA primitives. Extracted verbatim from cards/psa-lookup.js
// (getPsaApiKey, fetchCertImages) and cards/add-card.js (storePsaImage) so
// the trade and PA-promotion paths can reuse the same proven logic without
// forking it. Behavior-preserving move — see .agents/ROADMAP.md.
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const smClient = new SecretsManagerClient({});
const s3 = new S3Client({});
let psaApiKey;

async function getPsaApiKey() {
  if (psaApiKey) return psaApiKey;
  const secret = await smClient.send(
    new GetSecretValueCommand({ SecretId: "sports-card-portfolio/psa-api-key" })
  );
  psaApiKey = JSON.parse(secret.SecretString).apiKey;
  return psaApiKey;
}

// PSA's GetImagesByCertNumber returns the official front/back scan URLs as
// an array of { IsFrontImage, ImageURL }: two elements when PSA has the
// card, an empty array when it doesn't. We pick each side independently
// (defensive — never assume both-or-neither) and report a tri-state
// availability signal:
//   true  → PSA returned scans (array had elements)
//   false → PSA confirmed no scans (2xx, empty array)
//   null  → couldn't determine (non-2xx, malformed body, or thrown error)
// Best-effort: a failure here must NOT fail the overall cert lookup, so
// everything is wrapped and degrades to the null/unknown state. Self-fetches
// the API key so callers don't thread it through; on a warm cache this is a
// no-op, matching the pre-extraction call sequence.
async function fetchCertImages(certNumber) {
  try {
    const apiKey = await getPsaApiKey();
    const res = await fetch(
      `${process.env.PSA_API_BASE}/cert/GetImagesByCertNumber/${certNumber}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) {
      return { frontImageUrl: null, backImageUrl: null, psaImagesAvailable: null };
    }
    const images = await res.json();
    if (!Array.isArray(images)) {
      // Unexpected 2xx shape — treat as unknown, not confirmed-empty.
      return { frontImageUrl: null, backImageUrl: null, psaImagesAvailable: null };
    }
    if (images.length === 0) {
      return { frontImageUrl: null, backImageUrl: null, psaImagesAvailable: false };
    }
    const front = images.find((i) => i.IsFrontImage === true)?.ImageURL ?? null;
    const back  = images.find((i) => i.IsFrontImage === false)?.ImageURL ?? null;
    return { frontImageUrl: front, backImageUrl: back, psaImagesAvailable: true };
  } catch {
    return { frontImageUrl: null, backImageUrl: null, psaImagesAvailable: null };
  }
}

// PSA scan URLs come from the lookup response but reach this endpoint as
// client-supplied input, so a server-side fetch is an SSRF vector. Only
// fetch from PSA's known CloudFront host (the same host the lookup serves).
const PSA_IMAGE_HOST = "d1htnxwo4o0jhw.cloudfront.net";

// Best-effort server-side fetch of a PSA scan + store to our S3 bucket.
// Self-contained: returns false (never throws) on a bad host, malformed
// URL, non-2xx, or any fetch/S3 error, so a single side's failure can't
// abort the other side in the Promise.all caller.
async function storePsaImage(url, bucket, key) {
  try {
    if (new URL(url).host !== PSA_IMAGE_HOST) return false;
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: "image/jpeg" }));
    return true;
  } catch {
    return false;
  }
}

module.exports = { getPsaApiKey, fetchCertImages, storePsaImage };
