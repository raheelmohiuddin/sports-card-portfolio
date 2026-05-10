// POST /cards/lookup-cert — cert lookup for non-PSA graders (BGS / SGC).
//
// PSA lookups still go through the existing /psa/{certNumber} route
// which hits PSA's API directly — this Lambda is BGS/SGC only.
//
// Single CardHedger call: POST /v1/cards/details-by-certs.
// Body: { certs: [certNumber], grader }
// Response: { results: [{ cert_info, card }], total_requested, total_found }
//
// Two failure shapes both surface as 404 to the user:
//   • results array empty
//   • results[0].card is null  (cert known to CardHedger but not
//                              matched to a card in their catalog)
//
// Body in: { certNumber, grader }   (grader ∈ ["BGS", "SGC"])
const { json } = require("../_response");
const { isValidCertNumber } = require("../_validate");
const { safeImageUrl } = require("../_image-helpers");

const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const SECRET_ID = "sports-card-portfolio/cardhedger-api-key";
const BASE_URL  = "https://api.cardhedger.com";

const smClient = new SecretsManagerClient({});
let cachedKey;
async function getApiKey() {
  if (cachedKey) return cachedKey;
  const secret = await smClient.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
  cachedKey = JSON.parse(secret.SecretString).apiKey;
  return cachedKey;
}

const ALLOWED_GRADERS = new Set(["BGS", "SGC"]);

// Pull the year out of CardHedger's set string ("1998 Skybox …") or
// the cert description ("2017 Bowman Chrome …"). First 4-digit token
// wins.
function extractYear(s) {
  if (!s) return null;
  const m = String(s).match(/(\b\d{4}\b)/);
  return m ? m[1] : null;
}

// cert_info.grade comes back like "BECKETT 9.5" / "SGC 10". Strip the
// grader prefix so card.grade stores just the numeric value.
function extractNumericGrade(prefixedGrade) {
  if (!prefixedGrade) return null;
  const m = String(prefixedGrade).match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

// Heuristic parser for cert_info.description, used when CardHedger has
// the cert in their grading database but card: null (no catalog match).
//
// Rules per spec:
//   • year:        first 4-digit token in the string
//   • cardNumber:  trailing token if it looks like a card number
//                  (short, A-Z + digits, no lowercase letters)
//   • playerName:  last 2 tokens before the card number — works for
//                  the common 2-word name case ("Aaron Judge", "Larry
//                  Bird"). 1-word and 3-word names will be wrong; the
//                  amber-note flag the response carries tells the
//                  frontend to surface a "please verify" warning.
//   • brand:       everything between the year and the player name.
//
// Examples:
//   "2017 Bowman Chrome Rookie Autographs Green Refractors Aaron Judge CRAAJ"
//     → year 2017, brand "Bowman Chrome Rookie Autographs Green
//       Refractors", player "Aaron Judge", number CRAAJ.
//   "1998 Skybox E-X 2001 Derek Jeter Essential Credentials Future 7"
//     → year 1998, brand "Skybox E-X 2001 Derek Jeter Essential
//       Credentials", player "Future 7" — wrong! User must edit/verify.
function parseDescription(description) {
  if (!description) return null;
  const tokens = String(description).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const yearIdx = tokens.findIndex((t) => /^\d{4}$/.test(t));
  const year    = yearIdx >= 0 ? tokens[yearIdx] : null;

  const lastToken = tokens[tokens.length - 1];
  const looksLikeCardNumber = /^[A-Z0-9-]+$/.test(lastToken) && lastToken.length <= 10;
  const cardNumber = looksLikeCardNumber ? lastToken : null;

  const endIdx     = cardNumber ? tokens.length - 1 : tokens.length;
  const playerStart = Math.max(yearIdx + 1, endIdx - 2);
  const playerName  = tokens.slice(playerStart, endIdx).join(" ") || null;

  const brandStart = yearIdx + 1;
  const brand      = tokens.slice(brandStart, playerStart).join(" ") || null;

  return { year, brand, playerName, cardNumber };
}

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { certNumber, grader } = body;
  if (!isValidCertNumber(certNumber)) {
    return json(400, { error: "Invalid certNumber" });
  }
  if (!ALLOWED_GRADERS.has(grader)) {
    return json(400, { error: "grader must be BGS or SGC" });
  }

  let chRes;
  try {
    const apiKey = await getApiKey();
    const res = await fetch(`${BASE_URL}/v1/cards/details-by-certs`, {
      method:  "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body:    JSON.stringify({ certs: [certNumber.trim()], grader }),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`details-by-certs ${res.status}: ${errText}`);
      return json(502, { error: "CardHedger upstream error" });
    }
    chRes = await res.json();
  } catch (err) {
    console.error("details-by-certs failed:", err.message);
    return json(502, { error: "CardHedger upstream error" });
  }

  const results = Array.isArray(chRes?.results) ? chRes.results : [];
  if (results.length === 0) {
    return json(404, { error: "Card not found. Please try a different cert number." });
  }

  const certInfo = results[0].cert_info ?? {};
  const card     = results[0].card;

  // 404 only when cert_info itself is missing — every other branch
  // tries to give the user something usable (parsed from description
  // when card: null, full record when card is populated).
  if (!certInfo || (!certInfo.description && !certInfo.grade)) {
    return json(404, { error: "Card not found. Please try a different cert number." });
  }

  // Card record present → use catalog data verbatim.
  if (card) {
    return json(200, {
      certNumber:          String(certNumber).trim(),
      year:                extractYear(card.set) ?? extractYear(certInfo.description),
      brand:               card.set ?? null,
      sport:               card.category ?? null,
      playerName:          card.player ?? null,
      cardNumber:          card.number ?? null,
      grade:               extractNumericGrade(certInfo.grade),
      gradeDescription:    null,
      variety:             card.variant ?? null,
      psaPopulation:       null,
      psaPopulationHigher: null,
      frontImageUrl:       safeImageUrl(card.image),
      backImageUrl:        null,
      grader,
      cardhedgerId:        card.card_id ?? null,
      parsedFromDescription: false,
    });
  }

  // Card record absent → parse cert_info.description as a best-effort
  // fallback. parsedFromDescription flag tells the frontend to render
  // a "please verify" note.
  const parsed = parseDescription(certInfo.description) ?? {};
  return json(200, {
    certNumber:          String(certNumber).trim(),
    year:                parsed.year ?? null,
    brand:               parsed.brand ?? null,
    sport:               null,
    playerName:          parsed.playerName ?? null,
    cardNumber:          parsed.cardNumber ?? null,
    grade:               extractNumericGrade(certInfo.grade),
    gradeDescription:    null,
    variety:             null,
    psaPopulation:       null,
    psaPopulationHigher: null,
    frontImageUrl:       null,
    backImageUrl:        null,
    grader,
    cardhedgerId:        null,
    parsedFromDescription: true,
  });
};
