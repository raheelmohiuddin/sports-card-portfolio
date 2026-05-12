// PATCH /cards/{id}/mark-sold — collector records a self-sold card.
// Distinct from the consignment flow: a self-sold card never had its
// sale mediated by the platform, so it gets no consignment row, no
// fee, no sellers_net. Just price, date, venue.
//
// Idempotency is NOT enforced server-side: re-submitting with new venue
// data overwrites the prior values. This matches the locked decision
// that mark-as-sold is reversible from the UI (see OQ-3).
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidPrice, sanitize } = require("../_validate");

const VALID_VENUE_TYPES = new Set(["show", "auction", "other"]);
const MAX_AUCTION_HOUSE = 120;
const MAX_OTHER_TEXT    = 240;

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { soldPrice, soldAt, venueType, showId, auctionHouse, otherText } = body;

  // ── Scalar field validation ────────────────────────────────────────
  if (!isValidPrice(soldPrice)) {
    return json(400, { error: "soldPrice must be a non-negative number under 10,000,000" });
  }
  // Accept YYYY-MM-DD; reject anything else (no time component).
  if (!soldAt || !/^\d{4}-\d{2}-\d{2}$/.test(soldAt)) {
    return json(400, { error: "soldAt must be a YYYY-MM-DD date" });
  }
  if (!VALID_VENUE_TYPES.has(venueType)) {
    return json(400, { error: "venueType must be 'show', 'auction', or 'other'" });
  }

  // ── Venue-discriminator validation ─────────────────────────────────
  // Exactly one of showId / auctionHouse / otherText must be populated,
  // and it has to match venueType. The DB CHECK is the source of truth;
  // this is just a friendlier 400 than the constraint-violation 500.
  let showIdValue = null, auctionHouseValue = null, otherTextValue = null;
  if (venueType === "show") {
    if (!isValidId(showId)) return json(400, { error: "showId required for venueType='show'" });
    showIdValue = showId;
  } else if (venueType === "auction") {
    const ah = sanitize(auctionHouse, MAX_AUCTION_HOUSE);
    if (!ah) return json(400, { error: "auctionHouse required for venueType='auction'" });
    auctionHouseValue = ah;
  } else {
    const ot = sanitize(otherText, MAX_OTHER_TEXT);
    if (!ot) return json(400, { error: "otherText required for venueType='other'" });
    otherTextValue = ot;
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email,
    claims.given_name ?? null, claims.family_name ?? null);

  // ── Ownership + state preconditions ────────────────────────────────
  // Single query: card must belong to user, and the most-recent
  // consignment (if any) must NOT be in an open state. Mirrors the
  // LATERAL pattern from get-card.js so the constraint check is
  // consistent with what the UI reads.
  const guard = await db.query(
    `SELECT c.id, c.status AS card_status, cn.status AS consignment_status
     FROM cards c
     LEFT JOIN LATERAL (
       SELECT status FROM consignments
       WHERE card_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) cn ON TRUE
     WHERE c.id = $1 AND c.user_id = $2`,
    [cardId, userId],
  );
  if (guard.rowCount === 0) return json(404, { error: "Card not found" });
  const row = guard.rows[0];

  if (row.card_status === "traded") {
    return json(409, { error: "Card has been traded away; cannot mark as sold" });
  }
  // Open consignment states block mark-as-sold. Declined is allowed
  // (collector and admin agreed not to sell via platform; user is now
  // selling on their own). Sold is also rejected because the card is
  // already sold via the consignment path.
  const OPEN_CONSIGNMENT_STATES = new Set(["pending", "in_review", "listed"]);
  if (row.consignment_status === "sold") {
    return json(409, { error: "Card already sold via consignment" });
  }
  if (OPEN_CONSIGNMENT_STATES.has(row.consignment_status)) {
    return json(409, { error: "Card has an open consignment; cancel or decline it first" });
  }

  // ── Write ──────────────────────────────────────────────────────────
  // The CHECK constraint is defense-in-depth; the validation above
  // should already guarantee a passing row.
  await db.query(
    `UPDATE cards SET
       status             = 'sold',
       sold_price         = $1,
       sold_at            = $2::date,
       sold_venue_type    = $3,
       sold_show_id       = $4,
       sold_auction_house = $5,
       sold_other_text    = $6
     WHERE id = $7 AND user_id = $8`,
    [parseFloat(soldPrice), soldAt, venueType,
     showIdValue, auctionHouseValue, otherTextValue,
     cardId, userId],
  );

  return json(200, {
    id: cardId,
    status: "sold",
    soldPrice: parseFloat(soldPrice),
    soldAt,
    soldVenueType: venueType,
    soldShowId:       showIdValue,
    soldAuctionHouse: auctionHouseValue,
    soldOtherText:    otherTextValue,
  });
};
