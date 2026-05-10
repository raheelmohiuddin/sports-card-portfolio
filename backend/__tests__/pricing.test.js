// Note: pricing.js no longer has a "mock fallback" — that path was removed
// when we replaced the eBay stub with the CardHedger integration. Today the
// orchestrator returns null when CardHedger is unavailable. We test the pure
// helpers (gradeLabel) here; the network-bound paths (fetchMarketValue,
// fetchComps, fetchAllPrices) are covered by integration tests.
const { gradeLabel } = require("../functions/portfolio/pricing");

describe("gradeLabel", () => {
  test("extracts numeric grade from PSA grade strings", () => {
    expect(gradeLabel("GEM MT 10")).toBe("PSA 10");
    expect(gradeLabel("MINT 9")).toBe("PSA 9");
    expect(gradeLabel("NM-MT 8")).toBe("PSA 8");
  });

  test("handles plain numeric input", () => {
    expect(gradeLabel("10")).toBe("PSA 10");
    expect(gradeLabel(10)).toBe("PSA 10");
  });

  test("preserves half-grades (e.g. 9.5)", () => {
    expect(gradeLabel("9.5")).toBe("PSA 9.5");
    expect(gradeLabel("MINT 8.5")).toBe("PSA 8.5");
  });

  test("returns null for non-numeric inputs", () => {
    expect(gradeLabel("AUTHENTIC")).toBeNull();
    expect(gradeLabel("")).toBeNull();
    expect(gradeLabel(null)).toBeNull();
    expect(gradeLabel(undefined)).toBeNull();
  });
});
