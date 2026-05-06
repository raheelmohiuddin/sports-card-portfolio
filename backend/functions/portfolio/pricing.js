// Pricing module — supports mock data today, real eBay data tomorrow.
//
// To enable real eBay pricing, set ONE environment variable on the Lambda:
//   EBAY_APP_ID=your-ebay-app-id
//
// That's it. No code changes needed. The module automatically uses the live
// eBay Finding API when the credential is present and falls back to mock otherwise.

// ---------------------------------------------------------------------------
// eBay Finding API (live)
// ---------------------------------------------------------------------------

async function fetchFromEbay({ playerName, year, brand, cardNumber, grade }) {
  const keywords = [year, brand, playerName, cardNumber ? `#${cardNumber}` : null, `PSA ${grade}`]
    .filter(Boolean)
    .join(" ");

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": process.env.EBAY_APP_ID,
    "RESPONSE-DATA-FORMAT": "JSON",
    "keywords": keywords,
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "sortOrder": "EndTimeSoonest",
    "paginationInput.entriesPerPage": "25",
  });

  const res = await fetch(
    `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`eBay API ${res.status}`);

  const data = await res.json();
  const items =
    data.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];

  if (items.length === 0) return null;

  const prices = items.map((item) =>
    parseFloat(item.sellingStatus[0].currentPrice[0].__value__)
  );
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    avgSalePrice:  round2(avg),
    lastSalePrice: round2(prices[0]),
    numSales:      prices.length,
    source:        "ebay",
  };
}

// ---------------------------------------------------------------------------
// Mock pricing (deterministic — same cert always returns the same price)
// ---------------------------------------------------------------------------

const GRADE_BASE = {
  10: 180, 9.5: 95, 9: 55, 8.5: 35, 8: 22, 7: 14, 6: 9, 5: 6, 4: 4, 3: 3, 2: 2, 1: 1,
};

// Lightweight deterministic hash: maps a string to a float in [0, 1)
function pseudoRand(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 4294967296;
}

function parseGradeNum(grade) {
  const m = String(grade ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 7;
}

function fetchMock({ playerName, year, certNumber, grade }) {
  const gradeNum  = parseGradeNum(grade);
  const base      = GRADE_BASE[gradeNum] ?? GRADE_BASE[Math.round(gradeNum)] ?? 10;

  // Seed variance from the cert number so the price is stable across refreshes
  const r1 = pseudoRand(String(certNumber));
  const r2 = pseudoRand(String(certNumber) + "last");
  const r3 = pseudoRand(String(certNumber) + "sales");

  // Spread: ±40% around the base
  const avgSalePrice  = round2(base * (0.6 + r1 * 0.8));
  // Last sale within ±15% of avg
  const lastSalePrice = round2(avgSalePrice * (0.85 + r2 * 0.3));
  // 5–30 recent sales
  const numSales      = 5 + Math.floor(r3 * 26);

  return { avgSalePrice, lastSalePrice, numSales, source: "mock" };
}

// ---------------------------------------------------------------------------
// Public API — the only function callers should use
// ---------------------------------------------------------------------------

async function fetchMarketValue(cardInfo) {
  if (process.env.EBAY_APP_ID) {
    try {
      const result = await fetchFromEbay(cardInfo);
      if (result) return result;
    } catch (err) {
      console.warn("eBay pricing failed, using mock:", err.message);
    }
  }
  return fetchMock(cardInfo);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { fetchMarketValue };
