// POST /pricing/preview — returns CardHedger pricing for an arbitrary
// cert without persisting anything to the cards table. Used by the
// Trade Builder so the user can see the estimated value of a card
// they're considering trading FOR before they commit.
//
// Body shape:
//   { certNumber, playerName?, year?, brand?, cardNumber?, grade?, sport? }
//
// Returns the same shape fetchMarketValue produces:
//   { avgSalePrice, lastSalePrice, numSales, source, cardhedgerId,
//     cardhedgerImageUrl, rawComps }
// — or { available: false } when CardHedger has no confident match.
//
// No DB write. No cards.id is returned (this card is not in the user's
// portfolio yet). Auth is required so the secret + outbound bandwidth
// can't be abused anonymously, but the response data is identical for
// any caller for the same cert (card pricing is global).
const { fetchMarketValue } = require("../portfolio/pricing");
const { json } = require("../_response");
const { isValidCertNumber, sanitize } = require("../_validate");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  if (!isValidCertNumber(body.certNumber)) {
    return json(400, { error: "Invalid certNumber" });
  }

  let pricing;
  try {
    pricing = await fetchMarketValue({
      certNumber: body.certNumber.trim(),
      playerName: sanitize(body.playerName, 300),
      year:       sanitize(body.year, 10),
      brand:      sanitize(body.brand, 200),
      cardNumber: sanitize(body.cardNumber, 100),
      grade:      sanitize(body.grade, 10),
      sport:      sanitize(body.sport, 100),
      // No cardhedgerId — preview always runs the full match path.
    });
  } catch (err) {
    console.warn("Pricing preview failed:", err.message);
    return json(200, { available: false, reason: "lookup_failed" });
  }

  if (!pricing) {
    return json(200, { available: false, reason: "no_match" });
  }

  return json(200, {
    available:          true,
    avgSalePrice:       pricing.avgSalePrice,
    lastSalePrice:      pricing.lastSalePrice,
    numSales:           pricing.numSales,
    source:             pricing.source,
    cardhedgerId:       pricing.cardhedgerId,
    cardhedgerImageUrl: pricing.cardhedgerImageUrl,
  });
};
