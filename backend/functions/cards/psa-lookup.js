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

async function probeImage(url) {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const certNumber = event.pathParameters?.certNumber;
  if (!isValidCertNumber(certNumber)) {
    return json(400, { error: "Invalid certNumber — must be 1–30 alphanumeric characters" });
  }

  const apiKey = await getPsaApiKey();
  const cdnBase = `https://d1htnxwo4o0jhw.cloudfront.net/cert/${certNumber}`;

  const [apiResponse, frontImageUrl, backImageUrl] = await Promise.all([
    fetch(`${process.env.PSA_API_BASE}/cert/GetByCertNumber/${certNumber}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }),
    probeImage(`${cdnBase}/front.jpg`),
    probeImage(`${cdnBase}/back.jpg`),
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
    frontImageUrl,
    backImageUrl,
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
