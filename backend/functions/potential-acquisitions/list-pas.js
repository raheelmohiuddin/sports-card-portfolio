// GET /potential-acquisitions — the caller's PA list, newest-first.
// Mirrors get-cards.js per-card response shape so the frontend tile
// component can be reused with minimal branching (PA gets a "WANTED"
// corner ribbon per OQ-4; otherwise renders the same CardTile chrome).
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { safeImageUrl } = require("../_image-helpers");
const { signedCardImageUrl } = require("../_s3-helpers");

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, cert_number, grader, year, brand, sport, category, player_name,
            card_number, grade, grade_description, variant,
            psa_population, psa_population_higher,
            buy_target_price, notes, priority,
            estimated_value, avg_sale_price, last_sale_price, num_sales,
            price_source, value_last_updated,
            cardhedger_image_url, s3_image_key, s3_back_image_key,
            image_url, back_image_url,
            estimate_price, estimate_price_low, estimate_price_high,
            estimate_confidence, estimate_method,
            estimate_freshness_days, estimate_last_updated,
            added_at
     FROM potential_acquisitions
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [userId]
  );

  const pas = await Promise.all(
    result.rows.map(async (row) => {
      const [imageUrl, backImageUrl] = await Promise.all([
        row.s3_image_key
          ? signedCardImageUrl(row.s3_image_key)
          : Promise.resolve(safeImageUrl(row.cardhedger_image_url ?? row.image_url)),
        row.s3_back_image_key
          ? signedCardImageUrl(row.s3_back_image_key)
          : Promise.resolve(row.back_image_url ?? null),
      ]);

      return {
        id:                row.id,
        certNumber:        row.cert_number,
        grader:            row.grader ?? "PSA",
        year:              row.year,
        brand:             row.brand,
        sport:             row.sport,
        category:          row.category ?? null,
        playerName:        row.player_name,
        cardNumber:        row.card_number,
        grade:             row.grade,
        gradeDescription:  row.grade_description,
        variant:           row.variant ?? null,
        psaPopulation:        row.psa_population        ?? null,
        psaPopulationHigher:  row.psa_population_higher ?? null,
        buyTargetPrice:    row.buy_target_price ? parseFloat(row.buy_target_price) : null,
        notes:             row.notes    ?? null,
        priority:          row.priority ?? null,
        imageUrl,
        backImageUrl,
        estimatedValue:    row.estimated_value ? parseFloat(row.estimated_value) : null,
        avgSalePrice:      row.avg_sale_price  ? parseFloat(row.avg_sale_price)  : null,
        lastSalePrice:     row.last_sale_price ? parseFloat(row.last_sale_price) : null,
        numSales:          row.num_sales ?? null,
        priceSource:       row.price_source ?? null,
        valueLastUpdated:  row.value_last_updated ?? null,
        estimatePrice:         row.estimate_price          ? parseFloat(row.estimate_price)          : null,
        estimatePriceLow:      row.estimate_price_low      ? parseFloat(row.estimate_price_low)      : null,
        estimatePriceHigh:     row.estimate_price_high     ? parseFloat(row.estimate_price_high)     : null,
        estimateConfidence:    row.estimate_confidence    != null ? parseFloat(row.estimate_confidence) : null,
        estimateMethod:        row.estimate_method        ?? null,
        estimateFreshnessDays: row.estimate_freshness_days ?? null,
        estimateLastUpdated:   row.estimate_last_updated   ?? null,
        addedAt:           row.added_at,
      };
    })
  );

  return json(200, pas);
};
