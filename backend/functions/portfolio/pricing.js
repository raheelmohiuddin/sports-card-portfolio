// CardHedger pricing — the single source of truth for market value.
//
// Lookup chain per card:
//   1. prices-by-cert — exact match via the PSA cert number. Eliminates
//      variant-mismatch entirely (e.g. "Base" vs "Silver Prizm"). Returns
//      the card record (incl. an image we cache as a fallback) and the
//      raw recent-sale prices we use for avg/last/numSales.
//   2. card-match — fuzzy text match. Used only when prices-by-cert returns
//      no data (422 or empty prices array).
//
// Both paths call /v1/cards/comps afterwards to populate raw_comps for the
// sidebar (sale_url, price_source, sale_date — fields the prices-by-cert
// payload doesn't include).
//
// Returns null when neither path yields a confident match — callers must
// treat that as "no pricing available", not an error.

const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { safeImageUrl } = require("../_image-helpers");

const BASE_URL       = "https://api.cardhedger.com";
const SECRET_ID      = "sports-card-portfolio/cardhedger-api-key";
const MIN_CONFIDENCE = 0.7;

// Per-endpoint timeouts. card-match, prices-by-cert and all-prices-by-card
// are sub-second lookups; comps does time-weighted aggregation across recent
// sales and runs much slower for popular cards (PSA 10 Wembanyama, etc.).
const TIMEOUT_FAST_MS = 5000;
const TIMEOUT_SLOW_MS = 20000;

const smClient = new SecretsManagerClient({});
let cachedKey;

async function getApiKey() {
  if (cachedKey) return cachedKey;
  const secret = await smClient.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
  cachedKey = JSON.parse(secret.SecretString).apiKey;
  return cachedKey;
}

async function chPost(path, body, timeoutMs, opts = {}) {
  const apiKey = await getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeoutMs),
  });
  // prices-by-cert uses 422 to mean "no data for this cert" — caller opts in
  // and we surface null without throwing so the chain can fall through.
  if (res.status === 422 && opts.allow422) return null;
  if (!res.ok) {
    const errBody = await res.text().catch(() => "<unreadable>");
    console.error(`[CardHedger] POST ${path} -> ${res.status} body=${errBody}`);
    throw new Error(`CardHedger ${path} ${res.status}`);
  }
  return res.json();
}

// PSA's CardGrade looks like "GEM MT 10", "MINT 9", "NM-MT 8" — extract the
// numeric grade and prefix it with "PSA " so it matches CardHedger's grade
// keys ("PSA 10", "PSA 9", …). Returns null if no number is present.
function gradeLabel(grade) {
  const m = String(grade ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? `PSA ${m[1]}` : null;
}

// CardHedger's category filter is optional on card-match. Substring search
// across whatever text we have on the card; null when nothing matches.
function deriveCategory(...sources) {
  const haystack = sources.filter(Boolean).join(" ").toUpperCase();
  const KEYWORDS = [
    ["BASEBALL",   "Baseball"],
    ["BASKETBALL", "Basketball"],
    ["FOOTBALL",   "Football"],
    ["HOCKEY",     "Hockey"],
    ["SOCCER",     "Soccer"],
    ["TENNIS",     "Tennis"],
    ["ONE PIECE",  "One Piece"],
    ["POKEMON",    "Pokemon"],
    ["MAGIC",      "Magic"],
    ["TCG",        "TCG"],
  ];
  for (const [needle, label] of KEYWORDS) {
    if (haystack.includes(needle)) return label;
  }
  return null;
}

async function fetchComps(cardId, label) {
  return chPost("/v1/cards/comps", {
    card_id:           cardId,
    grade:             label,
    count:             10,
    include_raw_prices: true,
  }, TIMEOUT_SLOW_MS);
}

// Returns the full all-prices-by-card payload (every grade × grader
// CardHedger has on file for this card). Used by get-card-sales to
// build the grade-filter dropdown in the sidebar.
async function fetchAllPrices(cardId) {
  return chPost("/v1/cards/all-prices-by-card", { card_id: cardId }, TIMEOUT_FAST_MS);
}

async function tryPricesByCert(certNumber, label) {
  const res = await chPost(
    "/v1/cards/prices-by-cert",
    { cert: String(certNumber), grader: "PSA", days: 90 },
    TIMEOUT_FAST_MS,
    { allow422: true }
  );
  if (!res) return null;

  const prices = res.prices ?? [];
  if (prices.length === 0) return null;

  const card = res.card ?? {};
  const cardId = card.card_id;
  if (!cardId) return null;

  const sorted = [...prices].sort((a, b) =>
    new Date(b.closing_date) - new Date(a.closing_date)
  );
  const numericPrices = sorted
    .map((p) => parseFloat(p.price))
    .filter((n) => !Number.isNaN(n));
  if (numericPrices.length === 0) return null;

  const lastSalePrice = numericPrices[0];
  const numSales      = numericPrices.length;
  // Simple mean is the fallback. CardHedger returns prices-by-cert across the
  // requested window (90d here), so for any card whose price is moving the
  // simple mean lags reality. We prefer comps.comp_price below — that's
  // CardHedger's mean of the most-recent 10 sales — which tracks current
  // value far better. See conversation around cert 93794097 (Wembanyama)
  // where simple-mean said $854 but the card was actually trading at ~$1,060.
  const simpleMean = numericPrices.reduce((a, b) => a + b, 0) / numericPrices.length;

  const compsRes = await fetchComps(cardId, label);
  const compPrice = compsRes?.comp_price != null ? parseFloat(compsRes.comp_price) : null;
  const rawComps = compsRes?.raw_prices ?? [];

  const avgSalePrice = compPrice != null && !Number.isNaN(compPrice) ? compPrice : simpleMean;

  return {
    avgSalePrice:       round2(avgSalePrice),
    lastSalePrice:      round2(lastSalePrice),
    numSales,
    source:             "cardhedger-cert",
    cardhedgerId:       cardId,
    cardhedgerImageUrl: safeImageUrl(card.image),
    rawComps,
  };
}

function priceFromMatch(match, label) {
  const entry = (match?.prices ?? []).find((p) => p.grade === label);
  return entry ? parseFloat(entry.price) : null;
}

async function priceFromAllPrices(cardId, label) {
  const { prices = [] } = await chPost(
    "/v1/cards/all-prices-by-card",
    { card_id: cardId },
    TIMEOUT_FAST_MS
  );
  const entry = prices.find((p) => p.grade === label && p.grader === "PSA");
  return entry ? parseFloat(entry.price) : null;
}

async function tryCardMatch({ playerName, year, brand, cardNumber, label, sport, cardhedgerId }) {
  let cardId = cardhedgerId;
  let match;

  if (!cardId) {
    const query = [year, brand, playerName, cardNumber ? `#${cardNumber}` : null]
      .filter(Boolean)
      .join(" ");
    const category = deriveCategory(sport, brand);
    const matchRes = await chPost("/v1/cards/card-match", {
      query,
      ...(category ? { category } : {}),
      max_candidates: 5,
    }, TIMEOUT_FAST_MS);
    match = matchRes?.match;
    if (!match || match.confidence < MIN_CONFIDENCE) return null;
    cardId = match.card_id;
  }

  let gradePrice = match ? priceFromMatch(match, label) : null;
  if (gradePrice == null) {
    gradePrice = await priceFromAllPrices(cardId, label);
  }
  if (gradePrice == null) return null;

  const compsRes = await chPost("/v1/cards/comps", {
    card_id:           cardId,
    grade:             label,
    count:             10,
    include_raw_prices: true,
  }, TIMEOUT_SLOW_MS);

  if (compsRes?.comp_price == null) return null;

  const rawPrices = compsRes.raw_prices ?? [];
  const lastSalePrice = rawPrices[0] ? parseFloat(rawPrices[0].price) : null;
  const matchImage = safeImageUrl(match?.image);

  return {
    avgSalePrice:       round2(parseFloat(compsRes.comp_price)),
    lastSalePrice:      lastSalePrice != null ? round2(lastSalePrice) : null,
    numSales:           compsRes.count_used ?? rawPrices.length,
    source:             "cardhedger",
    cardhedgerId:       cardId,
    cardhedgerImageUrl: matchImage,
    rawComps:           rawPrices,
  };
}

async function fetchMarketValue({ certNumber, playerName, year, brand, cardNumber, grade, sport, cardhedgerId }) {
  const label = gradeLabel(grade);
  if (!label) return null;

  if (certNumber) {
    const certResult = await tryPricesByCert(certNumber, label);
    if (certResult) return certResult;
  }

  return await tryCardMatch({ playerName, year, brand, cardNumber, label, sport, cardhedgerId });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { fetchMarketValue, fetchComps, fetchAllPrices, gradeLabel };
