const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const Anthropic = require("@anthropic-ai/sdk");
const { json } = require("../_response");
const { isHttpsUrl } = require("../_validate");

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

const FALLBACK = { edgeColor: "#f2f0eb", texture: "white" };

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { imageUrl } = body;
  if (!isHttpsUrl(imageUrl)) {
    return json(400, { error: "imageUrl must be a valid HTTPS URL" });
  }

  try {
    // Fetch the card image
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) {
      console.warn(`Image fetch failed: ${imgRes.status} for ${imageUrl}`);
      return json(200, FALLBACK);
    }

    const buffer = await imgRes.arrayBuffer();
    if (buffer.byteLength > 4.5 * 1024 * 1024) {
      console.warn("Image too large for analysis, using fallback");
      return json(200, FALLBACK);
    }

    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim();

    const client = await getAnthropicClient();

    // claude-haiku-4-5: fast and cheap for simple color extraction.
    // Prompt caching not applied — the image changes per call so the prefix
    // is never stable enough to amortise the write cost.
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'Look at the thin outer border/edge of this trading card — the narrow paper margin visible around the card face. Return ONLY valid JSON with no other text:\n{"edgeColor":"#hexcolor","texture":"white|cream|colored"}\nThe edgeColor must be the exact hex of that visible paper border.',
            },
          ],
        },
      ],
    });

    const raw = response.content[0]?.text?.trim() ?? "";
    const parsed = JSON.parse(raw);

    if (!parsed.edgeColor || !/^#[0-9a-fA-F]{6}$/.test(parsed.edgeColor)) {
      console.warn("Claude returned invalid hex, using fallback. Raw:", raw);
      return json(200, FALLBACK);
    }

    return json(200, { edgeColor: parsed.edgeColor, texture: parsed.texture ?? "white" });
  } catch (err) {
    console.warn("Edge texture generation failed, using fallback:", err.message);
    return json(200, FALLBACK);
  }
};

