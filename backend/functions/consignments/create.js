// POST /consignments
// Collector creates a consignment request for a card they own. The DB has a
// partial unique index that prevents duplicate OPEN consignments for the same
// (user, card), so a 409 here means the user already has a request in flight.
//
// On success we fire-and-forget an SES email to the admin. SES failure is
// logged but does NOT fail the request — the consignment row is the source
// of truth; the email is just a nudge.
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, sanitize, isValidPrice } = require("../_validate");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");

const ses = new SESv2Client({});
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? ADMIN_EMAIL;

const VALID_TYPES = new Set(["auction", "private"]);

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { cardId, type, askingPrice, notes } = body;

  if (!isValidId(cardId)) return json(400, { error: "cardId required" });
  if (!VALID_TYPES.has(type)) return json(400, { error: "type must be 'auction' or 'private'" });

  const askProvided = askingPrice !== null && askingPrice !== undefined && askingPrice !== "";
  if (askProvided && !isValidPrice(askingPrice)) {
    return json(400, { error: "askingPrice must be a non-negative number under 10,000,000" });
  }
  const askingValue = askProvided ? parseFloat(askingPrice) : null;
  const notesValue = sanitize(notes, 2000);

  const db = await getPool();
  const userId = await ensureUser(
    db,
    claims.sub,
    claims.email,
    claims.given_name ?? null,
    claims.family_name ?? null,
  );

  // Verify the card belongs to this user — never let a user consign a card
  // they don't own. The query also gives us the card details we need for
  // the admin email, so it doubles as the lookup.
  const cardRow = await db.query(
    `SELECT id, player_name, year, brand, grade, cert_number,
            estimated_value, manual_price
     FROM cards
     WHERE id = $1 AND user_id = $2`,
    [cardId, userId]
  );
  if (cardRow.rowCount === 0) return json(404, { error: "Card not found" });
  const card = cardRow.rows[0];

  let consignment;
  try {
    const insert = await db.query(
      `INSERT INTO consignments (user_id, card_id, type, asking_price, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
      [userId, cardId, type, askingValue, notesValue]
    );
    consignment = insert.rows[0];
  } catch (err) {
    if (err.code === "23505") {
      return json(409, { error: "An open consignment request already exists for this card" });
    }
    throw err;
  }

  // Fire-and-forget admin notification. We await it to surface logs in
  // CloudWatch but swallow any error.
  try {
    if (ADMIN_EMAIL) {
      await sendAdminEmail({
        toEmail: ADMIN_EMAIL,
        fromEmail: SENDER_EMAIL,
        userName: [claims.given_name, claims.family_name].filter(Boolean).join(" ") || claims.email,
        userEmail: claims.email,
        card,
        type,
        askingPrice: askingValue,
        notes: notesValue,
      });
    }
  } catch (err) {
    console.error("consignment: SES send failed (non-fatal)", err);
  }

  return json(201, {
    id: consignment.id,
    status: consignment.status,
    createdAt: consignment.created_at,
  });
};

async function sendAdminEmail({ toEmail, fromEmail, userName, userEmail, card, type, askingPrice, notes }) {
  const cardLine = [card.year, card.brand, card.player_name].filter(Boolean).join(" ");
  const fmt = (n) => n != null ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—";
  const subject = `New ${type === "auction" ? "Auction" : "Private Sale"} Consignment — ${cardLine}`;

  const text = [
    `${userName} (${userEmail}) has submitted a new consignment request.`,
    ``,
    `Card:           ${cardLine}`,
    `Cert #:         ${card.cert_number ?? "—"}`,
    `Grade:          ${card.grade ?? "—"}`,
    `Estimated:      ${fmt(card.manual_price ?? card.estimated_value)}`,
    `Type:           ${type === "auction" ? "Auction" : "Private Sale"}`,
    `Asking price:   ${fmt(askingPrice)}`,
    `Notes:          ${notes ?? "—"}`,
    ``,
    `Review at https://collectorsreserve.co/admin/consignments`,
  ].join("\n");

  await ses.send(new SendEmailCommand({
    FromEmailAddress: fromEmail,
    Destination: { ToAddresses: [toEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: text, Charset: "UTF-8" } },
      },
    },
  }));
}
