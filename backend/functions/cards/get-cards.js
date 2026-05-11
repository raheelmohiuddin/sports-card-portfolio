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
    `SELECT c.id, c.cert_number, c.year, c.brand, c.sport, c.player_name, c.card_number,
            c.grade, c.grade_description, c.grader,
            c.s3_image_key, c.cardhedger_image_url,
            c.s3_back_image_key, c.back_image_url,
            c.psa_population, c.psa_population_higher,
            c.manual_price, c.my_cost, c.target_price,
            c.estimated_value, c.avg_sale_price, c.last_sale_price,
            c.num_sales, c.price_source, c.value_last_updated,
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
        addedAt:          row.added_at,
        consignmentStatus:     row.consignment_status     ?? null,
        consignmentSoldPrice:  row.consignment_sold_price != null ? parseFloat(row.consignment_sold_price) : null,
        consignmentFeePct:     row.consignment_fee_pct    != null ? parseFloat(row.consignment_fee_pct)    : null,
        sellersNet:            row.sellers_net            != null ? parseFloat(row.sellers_net)            : null,
        consignmentBlocked:    !!row.consignment_blocked,
        status:                row.status ?? null,
      };
    })
  );

  return json(200, cards);
};
