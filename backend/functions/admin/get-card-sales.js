// GET /admin/cards/{id}/sales?grade=...
//
// Admin-scoped mirror of portfolio/get-card-sales.js: same grade-filter
// behaviour, but skips the user_id ownership check so admins can see
// comps for any user's card. See the portfolio handler for the full
// rationale on the cached vs. live-fetch paths.
const { getPool } = require("../_db");
const { json } = require("../_response");
const { requireAdmin } = require("../_admin");
const { isValidId } = require("../_validate");
const { fetchComps, fetchAllPrices, gradeLabel } = require("../portfolio/pricing");

exports.handler = async (event) => {
  const db = await getPool();
  const guard = await requireAdmin(event, db);
  if (guard.error) return guard.error;

  const cardId = event.pathParameters?.id;
  if (!isValidId(cardId)) return json(400, { error: "Invalid card id" });

  const requestedGrade = event.queryStringParameters?.grade?.trim() || null;

  const result = await db.query(
    "SELECT raw_comps, cardhedger_id, grade FROM cards WHERE id = $1",
    [cardId]
  );
  if (result.rows.length === 0) return json(404, { error: "Card not found" });

  const row = result.rows[0];
  const ownGrade = gradeLabel(row.grade);
  const targetGrade = requestedGrade ?? ownGrade;

  let availableGrades = ownGrade ? [ownGrade] : [];
  if (row.cardhedger_id) {
    try {
      const allPrices = await fetchAllPrices(row.cardhedger_id);
      const fromApi = (allPrices?.prices ?? [])
        .map((p) => p.grade)
        .filter(Boolean);
      const set = new Set(fromApi);
      if (ownGrade) set.add(ownGrade);
      availableGrades = Array.from(set);
      if (ownGrade) {
        availableGrades = [ownGrade, ...availableGrades.filter((g) => g !== ownGrade)];
      }
    } catch (err) {
      console.warn("all-prices-by-card lookup failed:", err.message);
    }
  }

  // "all" sentinel — see portfolio/get-card-sales.js for rationale.
  if (requestedGrade === "all") {
    if (!row.cardhedger_id || availableGrades.length === 0) {
      return json(200, {
        sales: [], source: null,
        currentGrade: "all", availableGrades,
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
    if (!row.cardhedger_id) {
      return json(200, {
        sales: [], source: null,
        currentGrade: targetGrade, availableGrades,
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
        sales: [], source: null,
        currentGrade: targetGrade, availableGrades,
      });
    }
  }

  const sales = row.raw_comps ?? [];
  return json(200, {
    sales,
    source:       sales.length ? "cardhedger-cache" : null,
    currentGrade: ownGrade,
    availableGrades,
  });
};
