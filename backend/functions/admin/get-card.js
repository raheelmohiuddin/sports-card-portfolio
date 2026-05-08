// GET /admin/cards/{id} — single-card lookup for admins.
//
// Mirrors backend/functions/cards/get-card.js but skips the user_id ownership
// check so an admin can pull up any collector's card from the consignments
// queue. Includes the same lateral consignment join so the response shape
// matches the user-scoped endpoint and the frontend CardModal can render it
// unchanged.
const { getPool } = require("../_db");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");
const { isValidId } = require("../_validate");

const s3 = new S3Client({});

async function signedUrl(key) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.CARD_IMAGES_BUCKET, Key: key }),
    { expiresIn: 3600 }
  );
}

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const result = await db.query(
    `SELECT c.id, c.cert_number, c.year, c.brand, c.sport, c.player_name, c.card_number,
            c.grade, c.grade_description,
            c.s3_image_key, c.image_url,
            c.s3_back_image_key, c.back_image_url,
            c.psa_population, c.psa_population_higher,
            c.manual_price, c.my_cost, c.target_price,
            c.estimated_value, c.avg_sale_price, c.last_sale_price,
            c.num_sales, c.price_source, c.value_last_updated,
            c.added_at,
            cn.status     AS consignment_status,
            cn.sold_price AS consignment_sold_price,
            (cb.user_id IS NOT NULL) AS consignment_blocked
     FROM cards c
     LEFT JOIN LATERAL (
       SELECT status, sold_price FROM consignments
       WHERE card_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) cn ON TRUE
     LEFT JOIN consignment_blocks cb
       ON cb.user_id = c.user_id AND cb.cert_number = c.cert_number
     WHERE c.id = $1`,
    [cardId]
  );

  if (result.rows.length === 0) return json(404, { error: "Card not found" });

  const row = result.rows[0];
  const [imageUrl, backImageUrl] = await Promise.all([
    row.s3_image_key      ? signedUrl(row.s3_image_key)      : Promise.resolve(row.image_url      ?? null),
    row.s3_back_image_key ? signedUrl(row.s3_back_image_key) : Promise.resolve(row.back_image_url ?? null),
  ]);

  const manualPrice = row.manual_price ? parseFloat(row.manual_price) : null;
  const myCost      = row.my_cost      ? parseFloat(row.my_cost)      : null;
  const targetPrice = row.target_price ? parseFloat(row.target_price) : null;
  const estValue    = manualPrice ?? (row.estimated_value ? parseFloat(row.estimated_value) : null);
  const targetReached = targetPrice != null && estValue != null && estValue >= targetPrice;

  return json(200, {
    id:               row.id,
    certNumber:       row.cert_number,
    year:             row.year,
    brand:            row.brand,
    sport:            row.sport,
    playerName:       row.player_name,
    cardNumber:       row.card_number,
    grade:            row.grade,
    gradeDescription: row.grade_description,
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
    consignmentStatus:    row.consignment_status     ?? null,
    consignmentSoldPrice: row.consignment_sold_price != null ? parseFloat(row.consignment_sold_price) : null,
    consignmentBlocked:   !!row.consignment_blocked,
  });
};
