#!/usr/bin/env node
// scripts/backfill-valuations.js
//
// One-time backfill for the valuation rebuild per
// .agents/valuation-rebuild-plan.md §6.
//
// Walks every card with a non-null cert_number, runs the new 4-endpoint
// valuation flow (prices-by-cert → card-details → comps → price-estimate),
// renders a per-card report, and applies an UPDATE only after explicit y/n
// approval. Every decision is logged to scripts/backfill-logs/<timestamp>.json
// for audit.
//
// Pre-run checklist (see plan §6):
//   • Migration 0002 applied + verified
//   • Lambda code deployed (so live writes match the columns we touch here)
//   • Snapshot table created for emergency restore:
//       CREATE TABLE cards_pre_backfill AS SELECT * FROM cards;
//
// Run from repo root:
//   node scripts/backfill-valuations.js
//
// Flags:
//   --auto-approve-matches   Cards whose new card_id matches the cached
//                            cardhedger_id auto-apply with no prompt
//                            (just populates the new estimate_* + variant
//                            columns). Cards with a card_id mismatch OR
//                            with NULL cached cardhedger_id still prompt.

"use strict";

const { execFileSync } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

// ── AWS + CardHedger config (matches CONTEXT.md §2) ──────────────────
const SECRET_ARN   = "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM";
const CLUSTER_ARN  = "arn:aws:rds:us-east-1:501789774892:cluster:sportscardportfolio-databasecluster5b53a178-asr01cwjobbs";
const DB_NAME      = "cardportfolio";
const REGION       = "us-east-1";
const CH_SECRET_ID = "sports-card-portfolio/cardhedger-api-key";
const CH_BASE_URL  = "https://api.cardhedger.com";

// ── SQL helpers ──────────────────────────────────────────────────────
// Doubled single-quote escaping. Values come from CardHedger and our DB
// (both trusted) but the literal player names can contain apostrophes
// (e.g. "O'BRIEN") — without escape, the UPDATE would syntax-error.
function sqlString(s) {
  return s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`;
}
function sqlNum(n) {
  return n == null ? "NULL" : String(Number(n));
}

function execSql(sql) {
  const out = execFileSync("aws", [
    "rds-data", "execute-statement",
    "--secret-arn", SECRET_ARN,
    "--resource-arn", CLUSTER_ARN,
    "--database", DB_NAME,
    "--region", REGION,
    "--sql", sql,
    "--format-records-as", "JSON",
  ], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  return parsed.formattedRecords ? JSON.parse(parsed.formattedRecords) : [];
}

// ── CardHedger client ────────────────────────────────────────────────
function getApiKey() {
  const out = execFileSync("aws", [
    "secretsmanager", "get-secret-value",
    "--secret-id", CH_SECRET_ID,
    "--region", REGION,
    "--query", "SecretString",
    "--output", "text",
  ], { encoding: "utf8" });
  return JSON.parse(out.trim()).apiKey;
}

async function chPost(apiKey, route, body) {
  const res = await fetch(`${CH_BASE_URL}${route}`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 422) return null;          // "no data for this cert"
  if (!res.ok) throw new Error(`CardHedger ${route} → ${res.status}`);
  return res.json();
}

// Mirrors backend/functions/portfolio/pricing.js#gradeLabel.
function gradeLabel(grade) {
  const m = String(grade ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? `PSA ${m[1]}` : null;
}

// The new 4-endpoint orchestrator — same flow as
// backend/functions/portfolio/pricing.js#fetchValuation.
async function fetchValuation(apiKey, { certNumber, grader, grade }) {
  const label = gradeLabel(grade);
  if (!label) return null;

  const certRes = await chPost(apiKey, "/v1/cards/prices-by-cert", {
    cert: String(certNumber), grader: grader || "PSA", days: 90,
  });
  if (!certRes?.card?.card_id) return null;
  const cardId = certRes.card.card_id;

  const [detailsRes, compsRes, estimateRes] = await Promise.all([
    chPost(apiKey, "/v1/cards/card-details", { card_id: cardId }).catch(() => null),
    chPost(apiKey, "/v1/cards/comps", {
      card_id: cardId, grade: label, count: 10,
      time_weighted: true, include_raw_prices: true,
    }).catch(() => null),
    chPost(apiKey, "/v1/cards/price-estimate", { card_id: cardId, grade: label }).catch(() => null),
  ]);

  return {
    cardhedgerId: cardId,
    variant:      detailsRes?.cards?.[0]?.variant ?? null,
    comps:        compsRes,
    estimate:     estimateRes && estimateRes.price != null ? estimateRes : null,
  };
}

// ── Display helpers ──────────────────────────────────────────────────
function fmtUsd(n) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function tierLabel(confidence) {
  if (confidence == null) return "—";
  if (confidence < 0.5)  return "Low";
  if (confidence < 0.75) return "Medium";
  return "High";
}

// ── Interactive prompt ───────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Per-card UPDATE ──────────────────────────────────────────────────
// Plain SQL with inlined values. Mirrors the UPDATE in
// backend/functions/portfolio/refresh-portfolio.js — same column set,
// same value_last_updated stamping rationale (the next refresh job
// skips this card for 24h per the existing staleness gate).
function applyUpdate(cardId, valuation) {
  const e = valuation.estimate ?? {};
  const rawCompsJson = JSON.stringify(valuation.comps?.raw_prices ?? []);

  const sql = `
    UPDATE cards SET
      cardhedger_id           = ${sqlString(valuation.cardhedgerId)},
      variant                 = ${sqlString(valuation.variant)},
      estimate_price          = ${sqlNum(e.price != null ? round2(e.price) : null)},
      estimate_price_low      = ${sqlNum(e.price_low != null ? round2(e.price_low) : null)},
      estimate_price_high     = ${sqlNum(e.price_high != null ? round2(e.price_high) : null)},
      estimate_confidence     = ${sqlNum(e.confidence)},
      estimate_method         = ${sqlString(e.method)},
      estimate_freshness_days = ${sqlNum(e.freshness_days)},
      estimate_last_updated   = NOW(),
      raw_comps               = ${sqlString(rawCompsJson)}::jsonb,
      value_last_updated      = NOW()
    WHERE id = ${sqlString(cardId)}::uuid
  `;
  execSql(sql);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const autoApproveMatches = process.argv.includes("--auto-approve-matches");
  if (autoApproveMatches) {
    console.log("⚙ --auto-approve-matches: cards with unchanged card_id will apply without prompting.\n");
  }

  console.log("Fetching CardHedger API key…");
  const apiKey = getApiKey();
  console.log(`OK (length=${apiKey.length})\n`);

  console.log("Reading cards from DB…");
  const cards = execSql(`
    SELECT id, user_id, cert_number, COALESCE(grader, 'PSA') AS grader,
           player_name, year, brand, grade,
           cardhedger_id, estimated_value, variant
    FROM cards
    WHERE cert_number IS NOT NULL
    ORDER BY player_name
  `);
  console.log(`Found ${cards.length} cards with a cert_number.\n`);

  // Prepare log file
  const logDir = path.join(__dirname, "backfill-logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDir, `${stamp}.json`);
  const decisions = [];
  const writeLog = () => fs.writeFileSync(
    logPath,
    JSON.stringify({ startedAt: new Date().toISOString(), decisions }, null, 2)
  );

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const header = `Card ${i + 1} of ${cards.length}`;

    let valuation;
    try {
      valuation = await fetchValuation(apiKey, {
        certNumber: card.cert_number,
        grader:     card.grader,
        grade:      card.grade,
      });
    } catch (err) {
      console.log(`\n${header}: ${card.player_name} (cert ${card.cert_number})`);
      console.log(`  ⚠ valuation fetch errored: ${err.message}`);
      decisions.push({ cert: card.cert_number, decision: "error", error: err.message });
      writeLog();
      continue;
    }

    if (!valuation) {
      console.log(`\n${header}: ${card.player_name} (cert ${card.cert_number})`);
      console.log("  ⚠ valuation returned null (CardHedger has no data) — skipping.");
      decisions.push({ cert: card.cert_number, decision: "no_data" });
      writeLog();
      continue;
    }

    const idMismatch = card.cardhedger_id && valuation.cardhedgerId !== card.cardhedger_id;
    // "Match" = both ids exist AND they're equal. NULL cached id is NOT a
    // match (it's first-time data) so those still prompt under
    // --auto-approve-matches.
    const idMatches  = card.cardhedger_id && valuation.cardhedgerId === card.cardhedger_id;
    const e = valuation.estimate;
    const c = valuation.comps;

    console.log("\n────────────────────────────────────────────────────────────");
    console.log(header);
    console.log("────────────────────────────────────────────────────────────");
    console.log(`DB:  ${card.player_name} ${card.year ?? ""} ${card.brand ?? ""} (cert ${card.cert_number})`);
    console.log(`     cardhedger_id:   ${card.cardhedger_id ?? "(none)"}`);
    console.log(`     estimated_value: ${fmtUsd(card.estimated_value)}`);
    console.log(`     variant:         ${card.variant ?? "(none)"}`);
    console.log("");
    console.log("NEW:");
    console.log(`     card_id (cert resolved): ${valuation.cardhedgerId}${idMismatch ? "   [⚠ MISMATCH]" : ""}`);
    console.log(`     variant:                 ${valuation.variant ?? "(none)"}`);
    if (e) {
      console.log(`     estimate_price:          ${fmtUsd(e.price)} (range ${fmtUsd(e.price_low)}–${fmtUsd(e.price_high)}, conf ${e.confidence?.toFixed(2)} / ${tierLabel(e.confidence)})`);
      console.log(`     method:                  ${e.method ?? "—"}, freshness: ${e.freshness_days ?? "—"} days`);
    } else {
      console.log("     estimate_price:          (no data)");
    }
    if (c) {
      const n = c.count_used ?? (c.raw_prices?.length ?? 0);
      console.log(`     comps comp_price:        ${fmtUsd(c.comp_price)} (n=${n})`);
    } else {
      console.log("     comps:                   (no data)");
    }
    console.log("");

    // Approval gate. --auto-approve-matches skips the prompt for cards
    // whose card_id is unchanged (the "no review needed" case). Mismatches
    // and first-time backfills still require an explicit y/n.
    let answer;
    let approval;
    if (autoApproveMatches && idMatches) {
      answer = "y";
      approval = "auto";
      console.log("Apply this update? [auto-approved — id matches]");
    } else {
      answer = await prompt("Apply this update? [y/n/q] ");
      approval = "manual";
    }

    if (answer === "q") {
      console.log("Quitting. Already-applied updates remain.");
      decisions.push({ cert: card.cert_number, decision: "quit", approval });
      writeLog();
      break;
    }
    if (answer !== "y") {
      console.log("Skipped.");
      decisions.push({ cert: card.cert_number, decision: "skipped", approval });
      writeLog();
      continue;
    }

    try {
      applyUpdate(card.id, valuation);
      console.log(`✓ Applied${approval === "auto" ? " (auto)" : ""}.`);
      decisions.push({
        cert: card.cert_number,
        decision: "applied",
        approval,
        idMismatch,
        from: {
          cardhedger_id: card.cardhedger_id,
          estimated_value: card.estimated_value,
          variant: card.variant,
        },
        to: {
          cardhedger_id: valuation.cardhedgerId,
          variant: valuation.variant,
          estimate_price: e?.price ?? null,
          estimate_confidence: e?.confidence ?? null,
          estimate_method: e?.method ?? null,
        },
      });
    } catch (err) {
      console.log(`✗ UPDATE failed: ${err.message}`);
      decisions.push({ cert: card.cert_number, decision: "update_failed", approval, error: err.message });
    }
    writeLog();
  }

  console.log(`\nLog written to ${logPath}`);
  console.log(`Decisions: ${decisions.length}`);
  const counts = decisions.reduce((acc, d) => { acc[d.decision] = (acc[d.decision] || 0) + 1; return acc; }, {});
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
