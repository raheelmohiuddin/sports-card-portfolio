const { json } = require("../_response");
const { isValidCertNumber } = require("../_validate");
const { fetchEstimateForCert } = require("../portfolio/pricing");
const { getPsaApiKey, fetchCertImages } = require("../_psa");

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
    fetchCertImages(certNumber),
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
