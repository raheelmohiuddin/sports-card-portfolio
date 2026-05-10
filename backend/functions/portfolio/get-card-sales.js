const { getPool, ensureUser } = require("../_db");
const { json } = require("../_response");
const { isValidId } = require("../_validate");
const { fetchComps, fetchAllPrices, gradeLabel } = require("./pricing");

// GET /cards/{id}/sales?grade=PSA+10
//
// Returns recent sale comps for the card, plus the list of grades
// CardHedger has data for so the sidebar can render a grade-filter
// dropdown.
//
// Two paths depending on the requested grade:
//   • grade omitted OR matches the card's own grade
//       → return the cached raw_comps the refresh path already wrote
//         to the cards row. Fast (DB-only, no CardHedger call).
//   • grade differs from the card's own grade
//       → call CardHedger /v1/cards/comps live with the cached
//         cardhedger_id. Result is NOT persisted (avoids replacing
//         the canonical own-grade cache). Slower (the comps call
//         can take 5-20s for popular cards).
//
// availableGrades is fetched live from /v1/cards/all-prices-by-card
// on every call. It's a fast endpoint (sub-second) so the dropdown
// always reflects current CardHedger coverage.
exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const requestedGrade = event.queryStringParameters?.grade?.trim() || null;

  const db = await getPool();
  const userId = await ensureUser(db, claims.sub, claims.email);

  const result = await db.query(
    `SELECT raw_comps, cardhedger_id, grade
     FROM cards WHERE id = $1 AND user_id = $2`,
    [cardId, userId]
  );
  if (result.rows.length === 0) return json(404, { error: "Card not found" });

  const row = result.rows[0];
  const ownGrade = gradeLabel(row.grade); // e.g. "PSA 10"

  // Resolve which grade we'll return comps for. Falling back to the
  // card's own grade when no query param is given preserves the prior
  // contract for callers that don't know about the new ?grade= param.
  const targetGrade = requestedGrade ?? ownGrade;

  // Available grades — only meaningful when we have a cached
  // cardhedger_id (otherwise CardHedger has nothing to enumerate).
  // We always include the card's own grade so the dropdown can default
  // to it even if CardHedger somehow doesn't list it.
  let availableGrades = ownGrade ? [ownGrade] : [];
  if (row.cardhedger_id) {
    try {
      const allPrices = await fetchAllPrices(row.cardhedger_id);
      const fromApi = (allPrices?.prices ?? [])
        .map((p) => p.grade)
        .filter(Boolean);
      // Dedupe + keep the own-grade at the top of the list.
      const set = new Set(fromApi);
      if (ownGrade) set.add(ownGrade);
      availableGrades = Array.from(set);
      // Move ownGrade to position 0 if present.
      if (ownGrade) {
        availableGrades = [ownGrade, ...availableGrades.filter((g) => g !== ownGrade)];
      }
    } catch (err) {
      console.warn("all-prices-by-card lookup failed:", err.message);
      // Stale-friendly: fall back to just the own grade.
    }
  }

  // Sales path
  // "all" sentinel → fan out parallel comps fetches across every
  // available grade, merge the raw_prices, sort by sale_date desc.
  // Cardhedger has no built-in "all grades" endpoint so we synthesize
  // it here. Bounded by the slowest individual comps call (~5-20s)
  // since requests run in parallel via Promise.all.
  if (requestedGrade === "all") {
    if (!row.cardhedger_id || availableGrades.length === 0) {
      return json(200, {
        sales:           [],
        source:          null,
        currentGrade:    "all",
        availableGrades,
      });
    }
    const settled = await Promise.allSettled(
      availableGrades.map((g) => fetchComps(row.cardhedger_id, g))
    );
    const merged = settled.flatMap((r) =>
      r.status === "fulfilled" ? (r.value?.raw_prices ?? []) : []
    );
    merged.sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));
    return json(200, {
      sales:           merged,
      source:          "cardhedger",
      currentGrade:    "all",
      availableGrades,
    });
  }

  if (targetGrade && targetGrade !== ownGrade) {
    // Different grade requested — live fetch, no cache.
    if (!row.cardhedger_id) {
      return json(200, {
        sales:           [],
        source:          null,
        currentGrade:    targetGrade,
        availableGrades,
      });
    }
    try {
      const comps = await fetchComps(row.cardhedger_id, targetGrade);
      return json(200, {
        sales:           comps?.raw_prices ?? [],
        source:          "cardhedger",
        currentGrade:    targetGrade,
        availableGrades,
      });
    } catch (err) {
      console.warn("comps lookup failed:", err.message);
      return json(200, {
        sales:           [],
        source:          null,
        currentGrade:    targetGrade,
        availableGrades,
      });
    }
  }

  // Default path — return the cached raw_comps for the card's own grade.
  const sales = row.raw_comps ?? [];
  return json(200, {
    sales,
    source:       sales.length ? "cardhedger-cache" : null,
    currentGrade: ownGrade,
    availableGrades,
  });
};
