const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { safeImageUrl } = require("../_image-helpers");
const { signedCardImageUrl } = require("../_s3-helpers");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // LEFT JOIN LATERAL pulls the single most-recent consignment row per card.
  // We only ever care about the latest one for display: pending/in_review/
  // listed are open states, sold/declined are terminal. The frontend uses
  // this to swap the "Consign This Card" CTA for a read-only status pill.
  // consignment_blocks is keyed on (user_id, cert_number) so the block
  // persists across card deletion + re-add. The LEFT JOIN turns into a
  // boolean via `cb.user_id IS NOT NULL`.
  const result = await db.query(
    `SELECT c.id, c.cert_number, c.year, c.brand, c.sport, c.category, c.player_name, c.card_number,
            c.grade, c.grade_description, c.grader,
            c.s3_image_key, c.cardhedger_image_url,
            c.s3_back_image_key, c.back_image_url,
            c.psa_population, c.psa_population_higher,
            c.manual_price, c.my_cost, c.target_price,
            c.estimated_value, c.avg_sale_price, c.last_sale_price,
            c.num_sales, c.price_source, c.value_last_updated,
            c.estimate_price, c.estimate_price_low, c.estimate_price_high,
            c.estimate_confidence, c.estimate_method,
            c.estimate_freshness_days, c.estimate_last_updated,
            c.variant,
            c.sold_price, c.sold_at, c.sold_venue_type,
            c.sold_auction_house, c.sold_other_text,
            cs.id AS sold_show_id, cs.name AS sold_show_name, cs.show_date AS sold_show_date,
            c.status, c.added_at,
            cn.status     AS consignment_status,
            cn.sold_price AS consignment_sold_price,
            cn.consignment_fee_pct,
            cn.sellers_net,
            (cb.user_id IS NOT NULL) AS consignment_blocked
     FROM cards c
     LEFT JOIN LATERAL (
       SELECT status, sold_price, consignment_fee_pct, sellers_net
       FROM consignments
       WHERE card_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) cn ON TRUE
     LEFT JOIN consignment_blocks cb
       ON cb.user_id = c.user_id AND cb.cert_number = c.cert_number
     LEFT JOIN card_shows cs ON cs.id = c.sold_show_id
     WHERE c.user_id = $1
     ORDER BY c.added_at DESC`,
    [userId]
  );

  const cards = await Promise.all(
    result.rows.map(async (row) => {
      const [imageUrl, backImageUrl] = await Promise.all([
        row.s3_image_key      ? signedCardImageUrl(row.s3_image_key)      : Promise.resolve(safeImageUrl(row.cardhedger_image_url)),
        row.s3_back_image_key ? signedCardImageUrl(row.s3_back_image_key) : Promise.resolve(row.back_image_url ?? null),
      ]);

      const manualPrice = row.manual_price ? parseFloat(row.manual_price) : null;
      const myCost      = row.my_cost      ? parseFloat(row.my_cost)      : null;
      const targetPrice = row.target_price ? parseFloat(row.target_price) : null;
      const estValue    = manualPrice ?? (row.estimated_value ? parseFloat(row.estimated_value) : null);
      const targetReached = targetPrice != null && estValue != null && estValue >= targetPrice;

      return {
        id:               row.id,
        certNumber:       row.cert_number,
        year:             row.year,
        brand:            row.brand,
        sport:            row.sport,
        category:         row.category ?? null,
        playerName:       row.player_name,
        cardNumber:       row.card_number,
        grade:            row.grade,
        gradeDescription: row.grade_description,
        grader:           row.grader ?? "PSA",
        imageUrl,
        backImageUrl,
        psaPopulation:       row.psa_population        ?? null,
        psaPopulationHigher: row.psa_population_higher ?? null,
        manualPrice,
        myCost,
        targetPrice,
        targetReached,
        estimatedValue:   estValue,
        avgSalePrice:     row.avg_sale_price   ? parseFloat(row.avg_sale_price)   : null,
        lastSalePrice:    row.last_sale_price  ? parseFloat(row.last_sale_price)  : null,
        numSales:         row.num_sales        ?? null,
        priceSource:      manualPrice !== null ? "manual" : (row.price_source ?? null),
        valueLastUpdated: row.value_last_updated ?? null,
        // Valuation rebuild fields per .agents/valuation-rebuild-plan.md §3.
        // Frontend reads estimatePrice as the new headline value; estimatedValue
        // remains populated as a fallback during the staggered transition.
        estimatePrice:         row.estimate_price          ? parseFloat(row.estimate_price)          : null,
        estimatePriceLow:      row.estimate_price_low      ? parseFloat(row.estimate_price_low)      : null,
        estimatePriceHigh:     row.estimate_price_high     ? parseFloat(row.estimate_price_high)     : null,
        estimateConfidence:    row.estimate_confidence    != null ? parseFloat(row.estimate_confidence) : null,
        estimateMethod:        row.estimate_method        ?? null,
        estimateFreshnessDays: row.estimate_freshness_days ?? null,
        estimateLastUpdated:   row.estimate_last_updated   ?? null,
        variant:               row.variant                 ?? null,
        addedAt:          row.added_at,
        consignmentStatus:     row.consignment_status     ?? null,
        consignmentSoldPrice:  row.consignment_sold_price != null ? parseFloat(row.consignment_sold_price) : null,
        consignmentFeePct:     row.consignment_fee_pct    != null ? parseFloat(row.consignment_fee_pct)    : null,
        sellersNet:            row.sellers_net            != null ? parseFloat(row.sellers_net)            : null,
        consignmentBlocked:    !!row.consignment_blocked,
        status:                row.status ?? null,
        // Self-sold venue per .agents/mark-as-sold-plan.md §3. Populated
        // only when status='sold'; otherwise all eight fields are null.
        // sold_show_id / sold_show_name / sold_show_date come from the
        // LEFT JOIN to card_shows on c.sold_show_id.
        soldPrice:        row.sold_price ? parseFloat(row.sold_price) : null,
        soldAt:           row.sold_at instanceof Date
                            ? row.sold_at.toISOString().slice(0,10)
                            : (row.sold_at ?? null),
        soldVenueType:    row.sold_venue_type ?? null,
        soldShowId:       row.sold_show_id   ?? null,
        soldShowName:     row.sold_show_name ?? null,
        soldShowDate:     row.sold_show_date instanceof Date
                            ? row.sold_show_date.toISOString().slice(0,10)
                            : (row.sold_show_date ?? null),
        soldAuctionHouse: row.sold_auction_house ?? null,
        soldOtherText:    row.sold_other_text    ?? null,
      };
    })
  );

  return json(200, cards);
};
