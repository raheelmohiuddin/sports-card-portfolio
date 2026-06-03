const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { json } = require("../_response");
const { isValidCertNumber } = require("../_validate");
const { fetchEstimateForCert } = require("../portfolio/pricing");

const smClient = new SecretsManagerClient({});
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
// everything is wrapped and degrades to the null/unknown state.
async function fetchCertImages(apiKey, certNumber) {
  try {
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

exports.handler = async (event) => {
  const certNumber = event.pathParameters?.certNumber;
  if (!isValidCertNumber(certNumber)) {
    return json(400, { error: "Invalid certNumber — must be 1–30 alphanumeric characters" });
  }

  const apiKey = await getPsaApiKey();

  // GetByCertNumber (identity/grade) and GetImagesByCertNumber (scans) run
  // in parallel; the images call is NOT gated on cert success — on an
  // invalid cert it simply returns the unknown state and is discarded.
  const [apiResponse, images] = await Promise.all([
    fetch(`${process.env.PSA_API_BASE}/cert/GetByCertNumber/${certNumber}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }),
    fetchCertImages(apiKey, certNumber),
  ]);

  if (!apiResponse.ok) {
    if (apiResponse.status === 404) return json(404, { error: "Certificate not found" });
    return json(apiResponse.status, { error: "PSA API error" });
  }

  const data = await apiResponse.json();
  const cert = data.PSACert;

  // Best-effort estimate fetch — adds ~1s to the lookup but lets the
  // preview panel show the user what the card is worth before they
  // commit to adding it. Failure is non-fatal: identity preview still
  // renders, and add-card.js will refresh on save anyway.
  const estimate = await fetchEstimateForCert({
    certNumber: cert.CertNumber,
    grader:     "PSA",
    grade:      cert.CardGrade,
  }).catch(() => null);

  return json(200, {
    certNumber:          cert.CertNumber,
    year:                cert.Year,
    brand:               cert.Brand,
    sport:               cert.Sport,
    playerName:          cert.Subject,
    cardNumber:          cert.CardNumber,
    grade:               cert.CardGrade,
    gradeDescription:    cert.GradeDescription,
    variety:             cert.Variety,
    psaPopulation:       cert.TotalPopulation ?? null,
    psaPopulationHigher: cert.PopulationHigher ?? null,
    frontImageUrl:       images.frontImageUrl,
    backImageUrl:        images.backImageUrl,
    psaImagesAvailable:  images.psaImagesAvailable,
    psaData:             cert,
    estimatePrice:       estimate?.price      ?? null,
    estimatePriceLow:    estimate?.priceLow   ?? null,
    estimatePriceHigh:   estimate?.priceHigh  ?? null,
    estimateConfidence:  estimate?.confidence ?? null,
    estimateMethod:      estimate?.method     ?? null,
    // CardHedger-sourced category (e.g. "Football"). Frontend reads
    // this in place of the legacy PSA-sourced sport once commit 3 lands.
    category:            estimate?.category   ?? null,
  });
};
