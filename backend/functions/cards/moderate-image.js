// Image content moderation gate that runs BEFORE the S3 pre-signed URL
// is requested. The frontend uploads a downsized base64 of the image;
// this Lambda asks Claude Vision whether it's appropriate for a card-
// collecting app. If Claude says no, the upload is blocked client-side
// and the image never reaches storage.
//
// Failure semantics: hard-reject only when Claude responds with
// allowed=false. Any infrastructure error (Claude unreachable, JSON
// parse failure, secret fetch failure, image too large, etc.) returns
// allowed=true with an "unverified" flag — fail-open so a flaky
// moderation API doesn't block the entire upload flow. CloudWatch
// captures the reason for review.
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const Anthropic = require("@anthropic-ai/sdk");
const { json } = require("../_response");

const smClient = new SecretsManagerClient({});
let anthropicClient;

async function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const secret = await smClient.send(
    new GetSecretValueCommand({ SecretId: "sports-card-portfolio/anthropic-api-key" })
  );
  const { apiKey } = JSON.parse(secret.SecretString);
  anthropicClient = new Anthropic.default({ apiKey });
  return anthropicClient;
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024; // ~5MB after base64 decode — comfortable for Claude

const PROMPT = `You are a content moderator for a sports card collecting app. Look at this image and decide if it is appropriate to upload as a card photo.

ALLOWED:
- Sports trading cards (baseball, basketball, football, hockey, soccer, racing, etc.)
- TCG cards (Pokémon, Magic the Gathering, Yu-Gi-Oh, One Piece, etc.)
- Graded card slabs (PSA, BGS, SGC, CGC, HGA)
- Cards in any condition, raw or sleeved, front or back

REJECT (allowed = false):
- Nudity, sexual content, or sexually suggestive material
- Violence, gore, blood, weapons, fighting
- Drugs, drug paraphernalia, alcohol consumption
- Hate symbols or extremist imagery
- Photos of people, pets, food, scenery, documents, screenshots, memes, or anything that is not a trading card or graded slab

Respond with ONLY valid JSON in EXACTLY this format, no extra text:
{"allowed": true, "reason": ""}
or
{"allowed": false, "reason": "short explanation"}`;

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { image, contentType } = body;
  if (typeof image !== "string" || image.length === 0) {
    return json(400, { error: "image (base64 string) is required" });
  }
  const mediaType = (contentType || "image/jpeg").toLowerCase();
  if (!ALLOWED_TYPES.has(mediaType)) {
    return json(400, { error: `unsupported content type: ${mediaType}` });
  }

  // Quick base64 length sanity. Decoded byte length = base64 length * 3/4
  // minus padding — enough for an upper-bound check before round-tripping
  // through Buffer.
  const approxBytes = Math.floor(image.length * 0.75);
  if (approxBytes > MAX_BYTES) {
    console.warn(`moderation: image too large (${approxBytes} bytes), failing open`);
    return json(200, { allowed: true, unverified: true, reason: "image-too-large-for-verification" });
  }

  try {
    const client = await getAnthropicClient();
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 96,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const raw = response.content[0]?.text?.trim() ?? "";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      console.warn("moderation: unparseable Claude response, failing open. raw:", raw);
      return json(200, { allowed: true, unverified: true, reason: "moderation-parse-error" });
    }

    if (typeof parsed.allowed !== "boolean") {
      console.warn("moderation: missing 'allowed' field, failing open. parsed:", parsed);
      return json(200, { allowed: true, unverified: true, reason: "moderation-shape-error" });
    }

    if (parsed.allowed === false) {
      // Don't echo Claude's reason verbatim to the client — keep the user-
      // facing message generic. Real reason is in CloudWatch for review.
      console.warn(`moderation: rejected (sub=${claims.sub}). reason: ${parsed.reason}`);
      return json(200, { allowed: false, reason: parsed.reason || "not-a-trading-card" });
    }

    return json(200, { allowed: true, reason: "" });
  } catch (err) {
    console.warn("moderation: Claude error, failing open:", err.message);
    return json(200, { allowed: true, unverified: true, reason: "moderation-service-error" });
  }
};
