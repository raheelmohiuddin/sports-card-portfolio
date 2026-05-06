const { getPool, ensureUser } = require("../_db");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { json } = require("../_response");
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
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT id, cert_number, year, brand, sport, player_name, card_number,
            grade, grade_description,
            s3_image_key, image_url,
            s3_back_image_key, back_image_url,
            psa_population, psa_population_higher,
            manual_price,
            estimated_value, avg_sale_price, last_sale_price,
            num_sales, price_source, value_last_updated,
            added_at
     FROM cards
     WHERE id = $1 AND user_id = $2`,
    [cardId, userId]
  );

  if (result.rows.length === 0) return json(404, { error: "Card not found" });

  const row = result.rows[0];
  const [imageUrl, backImageUrl] = await Promise.all([
    row.s3_image_key      ? signedUrl(row.s3_image_key)      : Promise.resolve(row.image_url      ?? null),
    row.s3_back_image_key ? signedUrl(row.s3_back_image_key) : Promise.resolve(row.back_image_url ?? null),
  ]);

  const manualPrice = row.manual_price ? parseFloat(row.manual_price) : null;

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
      estimatedValue:   manualPrice ?? (row.estimated_value ? parseFloat(row.estimated_value) : null),
      avgSalePrice:     row.avg_sale_price   ? parseFloat(row.avg_sale_price)   : null,
      lastSalePrice:    row.last_sale_price  ? parseFloat(row.last_sale_price)  : null,
      numSales:         row.num_sales        ?? null,
      priceSource:      manualPrice !== null ? "manual" : (row.price_source ?? null),
      valueLastUpdated: row.value_last_updated ?? null,
      addedAt:          row.added_at,
  });
};
