const { getPool, ensureUser } = require("../_db");
const { fetchMarketValue, fetchValuation } = require("./pricing");
const { json } = require("../_response");
const { isValidId } = require("../_validate");

const STALE_HOURS = 24;

// Background refresh for stale cards. The frontend calls this AFTER the
// fast /portfolio/value read returns, so the user sees cached data
// immediately and updated prices flow in silently when this finishes.
//
// Default behaviour (empty body): walks every card without a manual_price
// override and refreshes those whose value_last_updated is older than
// STALE_HOURS.
//
// Targeted mode ({ cardIds: [...] }): scopes the SELECT to those ids and
// bypasses the staleness gate — the cards are refreshed unconditionally.
// Used by the Trade Builder right after confirm-cost so newly received
// cards have CardHedger pricing AND cardhedger_image_url populated by
// the time the user lands on My Cards.
//
// Returns { refreshed, skipped, failed }.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  // Optional body — only inspected when present so the parameterless
  // SWR call from PortfolioPage's mount keeps working unchanged.
  let cardIds = null;
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      if (Array.isArray(body.cardIds) && body.cardIds.every(isValidId)) {
        cardIds = body.cardIds;
      } else if (body.cardIds != null) {
        return json(400, { error: "cardIds must be an array of valid ids" });
      }
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = cardIds
    ? await db.query(
        `SELECT id, cert_number, player_name, year, brand, card_number, grade, sport,
                grader, manual_price, cardhedger_id, value_last_updated
         FROM cards WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, cardIds]
      )
    : await db.query(
        `SELECT id, cert_number, player_name, year, brand, card_number, grade, sport,
                grader, manual_price, cardhedger_id, value_last_updated
         FROM cards WHERE user_id = $1`,
        [userId]
      );

  const now = new Date();
  let refreshed = 0;
  let skipped   = 0;
  let failed    = 0;

  await Promise.all(
    result.rows.map(async (row) => {
      if (row.manual_price !== null && row.manual_price !== undefined) {
        skipped += 1;
        return;
      }

      // Targeted mode bypasses the staleness check — the caller has
      // explicitly named these cards as needing a refresh right now
      // (e.g. brand-new received cards from a trade). Default mode
      // still gates on STALE_HOURS so dashboard-mount calls don't
      // hammer CardHedger.
      const lastUpdated = row.value_last_updated ? new Date(row.value_last_updated) : null;
      const stale = cardIds
        ? true
        : (!lastUpdated || (now.getTime() - lastUpdated.getTime()) / 3600000 > STALE_HOURS);
      if (!stale) {
        skipped += 1;
        return;
      }

      // New flow per .agents/valuation-rebuild-plan.md §3: cert path uses
      // fetchValuation (4-endpoint orchestrator) for authoritative card_id
      // resolution + variant + price-estimate. Cert-less cards (legacy
      // fuzzy-match adds; defensive fallback for PSA) use fetchMarketValue.
      let v = null;
      let p = null;
      try {
        if (row.cert_number) {
          v = await fetchValuation({
            certNumber: row.cert_number,
            grader:     row.grader || "PSA",
            grade:      row.grade,
          });
        } else {
          p = await fetchMarketValue({
            certNumber:   row.cert_number,
            playerName:   row.player_name,
            year:         row.year,
            brand:        row.brand,
            cardNumber:   row.card_number,
            grade:        row.grade,
            sport:        row.sport,
            cardhedgerId: row.cardhedger_id,
          });
        }
      } catch (err) {
        console.warn("CardHedger pricing failed:", err.message);
        failed += 1;
        return;
      }

      if (!v && !p) {
        skipped += 1;
        return;
      }

      // Detect cardhedger_id mismatch — the cert path may now resolve to a
      // different card_id than what was cached (e.g. variant fix per the
      // valuation-rebuild plan). Logged only here; the UPDATE overwrites
      // cardhedger_id to the authoritative value either way.
      if (v?.cardhedgerId && row.cardhedger_id && v.cardhedgerId !== row.cardhedger_id) {
        console.log(`[refresh] cardhedger_id mismatch for cert ${row.cert_number}: ${row.cardhedger_id} -> ${v.cardhedgerId}`);
      }

      // Normalize fields from either path into one shape so the UPDATE is
      // single-statement. Estimate fields are null for the fuzzy-match
      // fallback (no price-estimate data).
      const fields = {
        avgSalePrice:          v?.comps?.avgSalePrice    ?? p?.avgSalePrice       ?? null,
        lastSalePrice:         v?.comps?.lastSalePrice   ?? p?.lastSalePrice      ?? null,
        numSales:              v?.comps?.numSales        ?? p?.numSales           ?? 0,
        cardhedgerId:          v?.cardhedgerId           ?? p?.cardhedgerId       ?? row.cardhedger_id,
        cardhedgerImageUrl:    v?.cardhedgerImageUrl     ?? p?.cardhedgerImageUrl ?? null,
        rawComps:              v?.comps?.rawComps        ?? p?.rawComps           ?? [],
        variant:               v?.variant                ?? null,
        estimatePrice:         v?.estimate?.price        ?? null,
        estimatePriceLow:      v?.estimate?.priceLow     ?? null,
        estimatePriceHigh:     v?.estimate?.priceHigh    ?? null,
        estimateConfidence:    v?.estimate?.confidence   ?? null,
        estimateMethod:        v?.estimate?.method       ?? null,
        estimateFreshnessDays: v?.estimate?.freshnessDays ?? null,
      };

      await db.query(
        `UPDATE cards SET
           estimated_value      = COALESCE($1, estimated_value),
           avg_sale_price       = $1,
           last_sale_price      = $2,
           num_sales            = $3,
           price_source         = 'cardhedger',
           cardhedger_id        = $4,
           cardhedger_image_url = COALESCE($5, cardhedger_image_url),
           raw_comps            = $6,
           value_last_updated   = NOW(),
           estimate_price          = $7,
           estimate_price_low      = $8,
           estimate_price_high     = $9,
           estimate_confidence     = $10,
           estimate_method         = $11,
           estimate_freshness_days = $12,
           estimate_last_updated   = NOW(),
           variant                 = COALESCE($13, variant)
         WHERE id = $14`,
        [
          fields.avgSalePrice,
          fields.lastSalePrice,
          fields.numSales,
          fields.cardhedgerId,
          fields.cardhedgerImageUrl,
          JSON.stringify(fields.rawComps),
          fields.estimatePrice,
          fields.estimatePriceLow,
          fields.estimatePriceHigh,
          fields.estimateConfidence,
          fields.estimateMethod,
          fields.estimateFreshnessDays,
          fields.variant,
          row.id,
        ]
      );
      refreshed += 1;
    })
  );

  return json(200, { refreshed, skipped, failed });
};
