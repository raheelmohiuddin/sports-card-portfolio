// POST /trades/analyze — AI-driven trade analysis.
//
// Frontend sends the in-progress trade (given card IDs + received card
// metadata + cash). We enrich the given side from the DB (raw_comps,
// my_cost, estimated_value, PSA pop, etc.) and pass the full picture
// to Claude Sonnet 4.6 with tool_use to force a structured JSON
// response. Received cards arrive with whatever metadata the frontend
// could resolve via /pricing/preview — we pass that through as-is.
//
// Returns: {
//   summary, valueAnalysis, shortTermOutlook, longTermOutlook,
//   populationAnalysis, salesVelocity, riskAssessment,
//   verdict: "FAVORABLE"|"NEUTRAL"|"UNFAVORABLE",
//   confidence: 0-100,
//   keyReasons: string[]
// }
const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId, isValidCertNumber, isValidPrice } = require("../_validate");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const Anthropic = require("@anthropic-ai/sdk");

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

// Cap raw_comps at 20 most-recent sales per card to keep prompts under
// reasonable token budgets. CardHedger sometimes returns 100+ comps for
// popular cards; the recency tail is what matters for velocity analysis.
const COMPS_LIMIT_PER_CARD = 20;

// Captured at module load so the dilution-age rules in the prompt
// always reference the right cutoff. Cold starts on a year boundary
// pick up the new value automatically.
const CURRENT_YEAR = new Date().getFullYear();

const TOOL = {
  name: "report_trade_analysis",
  description: "Report the structured trade analysis to the caller.",
  input_schema: {
    type: "object",
    properties: {
      summary:            { type: "string", description: "1–2 sentence executive overview of the trade." },
      valueAnalysis:      { type: "string", description: "Net value gain/loss and the immediate financial impact." },
      shortTermOutlook:   { type: "string", description: "0–6 month outlook for the cards involved." },
      longTermOutlook:    { type: "string", description: "1–3 year outlook based on player trajectory and category trends." },
      populationAnalysis: { type: "string", description: "Whether cards are getting scarcer or PSA is grading more." },
      salesVelocity:      { type: "string", description: "Are recent prices accelerating, decelerating, or stable?" },
      riskAssessment:     { type: "string", description: "Concentration, liquidity, and market-timing risks." },
      verdict:            { type: "string", enum: ["FAVORABLE", "NEUTRAL", "UNFAVORABLE"] },
      confidence:         { type: "number", description: "0–100 confidence in the verdict." },
      keyReasons:         { type: "array", items: { type: "string" }, description: "3–6 bullet-point reasons supporting the verdict." },
    },
    required: [
      "summary", "valueAnalysis", "shortTermOutlook", "longTermOutlook",
      "populationAnalysis", "salesVelocity", "riskAssessment",
      "verdict", "confidence", "keyReasons",
    ],
  },
};

const SYSTEM_PROMPT = (() => `You are a professional sports card and TCG investment analyst with deep expertise in graded card markets, PSA population dynamics, comp-driven valuation, liquidity analysis, volatility assessment, and category trends. You are advising a collector evaluating a specific trade.

Be direct, data-driven, and honest. Do NOT hedge to be polite — if a trade is bad, say UNFAVORABLE and explain why concretely. If it's a clear win, call it FAVORABLE.

Work through these dimensions, computing from the raw_comps sales history where needed:

VALUE
- Trade-time estimated values drive the immediate gain/loss math.
- Cash given is an outflow you must justify; cash received is realized liquidity.

POPULATION (apply the dilution-age rule below + the serialization override)
- psa_population (at-grade) + population_higher (graded higher) determine scarcity.

POPULATION DILUTION — age-gated (current year is ${CURRENT_YEAR})
- Cards 0–2 years old (year ≥ ${CURRENT_YEAR - 2}): submission risk is REAL — PSA may grade many more copies. Flag this as a dilution risk.
- Cards 3–5 years old (year ${CURRENT_YEAR - 5}–${CURRENT_YEAR - 3}): moderate dilution risk — most submissions have happened, long tail continues.
- Cards 6+ years old (year ≤ ${CURRENT_YEAR - 6}): DO NOT mention dilution risk. The graded population is stable; submission waves are essentially complete. Vintage / classic cards do not get dilution flags.

SERIALIZED / LIMITED PRINT RUNS (overrides the age rule when applicable)
- Inspect each card's brand, gradeDescription, and any variant indicator for print-run markers: "refractor", "serialized", "numbered", "/10", "/25", "/50", "/99", "/150", "/199", "/499", or any /N notation.
- For serialized cards the print run is a HARD CAP — PSA cannot grade more copies than exist. The age rule does NOT apply.
- In the populationAnalysis field for a serialized card, state explicitly: "This card is serialized to [X] copies. PSA has graded [Y] copies, representing [Y/X*100]% of the total print run." Round the percentage.
- When a meaningful share is already graded (≥ 40%), call this out as a POSITIVE scarcity signal — future dilution is mathematically constrained. Adjust riskAssessment so normalization/dilution risk is downgraded for serialized cards with high graded share.

LIQUIDITY (critical — penalize heavily when poor)
- Count recent sales in raw_comps. Fewer than ~3 sales in the last 90 days = ILLIQUID regardless of headline value.
- Inspect time gaps between consecutive sales: frequent trades signal a healthy market; long gaps signal a card that sits.
- Illiquidity means you may not exit at the headline price when you need to. Weight this heavily in the verdict.

VOLATILITY & SUSTAINABILITY
- Compare the most recent ~5 sales to the prior ~5 sales: accelerating, decelerating, or stable?
- Spread between recent high and low prices: a wide spread = high volatility = price is uncertain.
- If prices have risen sharply (e.g. doubled in a short window) ask: is the rise backed by sufficient volume? A 5x rise on 3 sales is speculative; a 5x rise on 50 sales is real demand. Call out thin-volume spikes EXPLICITLY as speculative and risky.

EVENT-DRIVEN MOVEMENT
- Sports cards: is the player currently performing at a high level (playoffs, championship run, breakout season, MVP race)? Use what you know about player trajectories and the current sports calendar to reason about whether a recent spike is event-driven.
- TCG: is there a recent set release, tournament meta shift, anime arc, or other catalyst that could drive temporary demand?
- Event-driven spikes typically normalize once the catalyst fades. Flag this risk where it applies.

NORMALIZATION RISK
- If a card is trading significantly above its 90-day average, the risk is mean reversion. Estimate the premium-over-average from raw_comps and express it as a percentage. Call it out when material (e.g. > 25% above 90-day average).

RISK ASSESSMENT (riskAssessment field) must explicitly cover, in order:
1) Liquidity risk
2) Volatility risk
3) Event-driven price risk
4) Normalization / mean-reversion risk
Plus concentration risk if the user is trading diversified holdings for a single high-priced card.

SALES VELOCITY (salesVelocity field) must include:
- Average price last 30 days vs prior 30 days (compute from raw_comps sale_dates; estimate if data is sparse)
- Trend direction: accelerating up / steady / decelerating / declining
- Volume trend: more or fewer recent sales
- Sustainability score: High / Medium / Low (justify briefly)

Use the report_trade_analysis tool to return your analysis. Do not respond in plain text.

CRITICAL: hard brevity — 2 to 3 sentences per section, no exceptions. Summary is ONE sentence. keyReasons is 4 to 5 short bullet points (one line each, ≤ 12 words). The total output budget is ~1200 tokens; if you exceed it the response gets cut off mid-section. Be terse and specific over verbose.`)();

function trimComps(rawComps) {
  if (!rawComps) return [];
  const arr = Array.isArray(rawComps) ? rawComps : (rawComps.sales ?? rawComps.comps ?? []);
  if (!Array.isArray(arr)) return [];
  // Sort newest first by sale_date if present, else preserve order.
  const sorted = arr.slice().sort((a, b) => {
    const da = a?.sale_date ? new Date(a.sale_date).getTime() : 0;
    const db = b?.sale_date ? new Date(b.sale_date).getTime() : 0;
    return db - da;
  });
  return sorted.slice(0, COMPS_LIMIT_PER_CARD).map((s) => ({
    price:        s.price ?? null,
    sale_date:    s.sale_date ?? null,
    source:       s.price_source ?? s.source ?? null,
    grade:        s.grade ?? null,
  }));
}

function describeCard(c, side) {
  const lines = [
    `[${side.toUpperCase()}] ${c.playerName ?? "Unknown"} ${c.year ?? ""} ${c.brand ?? ""}${c.cardNumber ? ` #${c.cardNumber}` : ""}`,
    `  Cert: ${c.certNumber ?? "—"} · Grade: ${c.grade ?? "—"}${c.gradeDescription ? ` (${c.gradeDescription})` : ""}`,
    `  Sport/Category: ${c.sport ?? "—"}`,
    `  PSA Pop: at-grade ${c.psaPopulation ?? "?"}, graded-higher ${c.psaPopulationHigher ?? "?"}`,
  ];
  if (c.estimatedValue != null) lines.push(`  Estimated value: $${Number(c.estimatedValue).toFixed(2)}`);
  if (c.myCost != null)         lines.push(`  Cost basis: $${Number(c.myCost).toFixed(2)}`);
  if (c.avgSalePrice != null)   lines.push(`  Avg sale price: $${Number(c.avgSalePrice).toFixed(2)}`);
  if (c.lastSalePrice != null)  lines.push(`  Last sale: $${Number(c.lastSalePrice).toFixed(2)}`);
  if (c.numSales != null)       lines.push(`  Number of comps: ${c.numSales}`);
  const comps = trimComps(c.rawComps);
  if (comps.length > 0) {
    lines.push(`  Recent sales (newest first):`);
    for (const s of comps) {
      lines.push(`    - $${s.price ?? "?"} on ${s.sale_date ?? "?"} (${s.source ?? "?"}, grade ${s.grade ?? "?"})`);
    }
  }
  return lines.join("\n");
}

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const cardsGiven    = Array.isArray(body.cardsGiven)    ? body.cardsGiven    : [];
  const cardsReceived = Array.isArray(body.cardsReceived) ? body.cardsReceived : [];
  const cashGiven     = Number(body.cashGiven)    || 0;
  const cashReceived  = Number(body.cashReceived) || 0;

  if (cardsGiven.length === 0 && cardsReceived.length === 0) {
    return json(400, { error: "Trade must include at least one card on either side" });
  }
  // Given side arrives as IDs only; received side as metadata objects.
  for (const id of cardsGiven) {
    if (!isValidId(id)) return json(400, { error: "Invalid card id in cardsGiven" });
  }
  for (const c of cardsReceived) {
    if (!c || !isValidCertNumber(c.certNumber)) {
      return json(400, { error: "Invalid certNumber in cardsReceived" });
    }
  }
  if (!isValidPrice(cashGiven) || !isValidPrice(cashReceived)) {
    return json(400, { error: "cashGiven and cashReceived must be non-negative numbers" });
  }

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  // Pull DB-side enrichment for the given cards. Ownership is enforced
  // server-side so a malicious caller can't analyze cards they don't own.
  let givenEnriched = [];
  if (cardsGiven.length > 0) {
    const rows = await db.query(
      `SELECT id, cert_number, year, brand, sport, player_name, card_number,
              grade, grade_description, psa_population, psa_population_higher,
              my_cost, estimated_value, avg_sale_price, last_sale_price,
              num_sales, raw_comps
       FROM cards
       WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [cardsGiven, userId]
    );
    if (rows.rows.length !== cardsGiven.length) {
      return json(400, { error: "One or more given cards aren't owned by this user" });
    }
    givenEnriched = rows.rows.map((r) => ({
      certNumber:          r.cert_number,
      year:                r.year,
      brand:               r.brand,
      sport:               r.sport,
      playerName:          r.player_name,
      cardNumber:          r.card_number,
      grade:               r.grade,
      gradeDescription:    r.grade_description,
      psaPopulation:       r.psa_population,
      psaPopulationHigher: r.psa_population_higher,
      myCost:              r.my_cost,
      estimatedValue:      r.estimated_value,
      avgSalePrice:        r.avg_sale_price,
      lastSalePrice:       r.last_sale_price,
      numSales:            r.num_sales,
      rawComps:            r.raw_comps,
    }));
  }

  const userPrompt = [
    "Analyze this proposed trade and return your verdict via the report_trade_analysis tool.",
    "",
    `CASH: given $${cashGiven.toFixed(2)}, received $${cashReceived.toFixed(2)}`,
    "",
    "===== CARDS BEING GIVEN AWAY =====",
    givenEnriched.length === 0 ? "  (none)" : givenEnriched.map((c) => describeCard(c, "given")).join("\n\n"),
    "",
    "===== CARDS BEING RECEIVED =====",
    cardsReceived.length === 0 ? "  (none)" : cardsReceived.map((c) => describeCard(c, "received")).join("\n\n"),
  ].join("\n");

  try {
    const client = await getAnthropicClient();
    // max_tokens 1200 + the brevity directive in the system prompt
    // keeps the call comfortably inside API Gateway HTTP API's hard
    // 30s integration timeout. Empirically at 1500 we saw 34.9s
    // worst-case with the enriched prompt — too close to the line.
    // 1200 tokens / ~50 tok/s ≈ 24s + overhead = ~25s total, leaving
    // a 5s margin.
    const result = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_trade_analysis" },
    });

    const toolUseBlock = result.content.find((b) => b.type === "tool_use");
    if (!toolUseBlock || !toolUseBlock.input) {
      console.error("Analyze-trade: no tool_use block in response", JSON.stringify(result));
      return json(502, { error: "Analysis returned no structured result" });
    }
    return json(200, toolUseBlock.input);
  } catch (err) {
    console.error("Analyze-trade failed:", err);
    return json(500, { error: "Analysis failed: " + (err?.message ?? "unknown") });
  }
};
