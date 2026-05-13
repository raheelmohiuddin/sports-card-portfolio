import { describe, test, expect } from "vitest";
import {
  isSold,
  isTraded,
  effectiveValue,
  cardPnl,
  summarizePortfolio,
  confidenceLabel,
} from "../portfolio.js";

const heldCard = (overrides = {}) => ({
  id: "h1",
  myCost: 100,
  estimatedValue: 150,
  ...overrides,
});

const soldCard = (overrides = {}) => ({
  id: "s1",
  myCost: 80,
  consignmentStatus: "sold",
  consignmentSoldPrice: 120,
  ...overrides,
});

// Self-sold fixture per .agents/mark-as-sold-plan.md §5. Distinct from
// soldCard above (which is consignment-sold) — keys on cards.status
// + sold_price, not on consignmentStatus. No sellers_net concept since
// the user handled the sale themselves.
const selfSoldCard = (overrides = {}) => ({
  id: "ss1",
  myCost: 80,
  status: "sold",
  soldPrice: 130,
  ...overrides,
});

describe("isSold / isTraded", () => {
  test("isSold true only when status='sold' AND price is set", () => {
    expect(isSold(soldCard())).toBe(true);
    expect(isSold({ consignmentStatus: "sold", consignmentSoldPrice: null })).toBe(false);
    expect(isSold({ consignmentStatus: "listed", consignmentSoldPrice: 100 })).toBe(false);
  });

  test("isTraded keys on cards.status='traded'", () => {
    expect(isTraded({ status: "traded" })).toBe(true);
    expect(isTraded({ status: null })).toBe(false);
  });

  test("isSold also true for self-sold (cards.status='sold' + soldPrice)", () => {
    expect(isSold(selfSoldCard())).toBe(true);
    // Status alone isn't enough — price must also be set.
    expect(isSold({ status: "sold", soldPrice: null })).toBe(false);
    // Disjunction: self-sold satisfies even with no consignment fields.
    expect(isSold({ status: "sold", soldPrice: 100 })).toBe(true);
  });
});

describe("effectiveValue", () => {
  test("returns soldPrice for sold cards (realized exit, legacy/no fee)", () => {
    expect(effectiveValue(soldCard())).toBe(120);
  });

  test("prefers sellersNet over soldPrice for sold cards (post-fee schema)", () => {
    // Gross 120, fee, collector pockets 100 — P&L should use 100, not 120.
    expect(effectiveValue(soldCard({ sellersNet: 100 }))).toBe(100);
  });

  test("falls back to soldPrice when sellersNet is null", () => {
    expect(effectiveValue(soldCard({ sellersNet: null }))).toBe(120);
  });

  test("returns estimatedValue for held cards", () => {
    expect(effectiveValue(heldCard())).toBe(150);
  });

  test("returns null when neither is available", () => {
    expect(effectiveValue({ myCost: 100 })).toBeNull();
    expect(effectiveValue(null)).toBeNull();
  });

  test("self-sold returns soldPrice; sellersNet is irrelevant (no platform fee)", () => {
    expect(effectiveValue(selfSoldCard())).toBe(130);
    // Even if a stale sellersNet is present on a self-sold card, soldPrice wins.
    expect(effectiveValue(selfSoldCard({ sellersNet: 999 }))).toBe(130);
  });

  // Valuation rebuild precedence (per MASTER §1.5 + OQ-4):
  //   manualPrice ?? estimatePrice ?? estimatedValue ?? null
  test("prefers estimatePrice over estimatedValue for held cards", () => {
    expect(effectiveValue(heldCard({ estimatePrice: 175, estimatedValue: 150 }))).toBe(175);
  });

  test("prefers manualPrice over estimatePrice for held cards (OQ-4)", () => {
    expect(effectiveValue(heldCard({ manualPrice: 200, estimatePrice: 175, estimatedValue: 150 }))).toBe(200);
  });

  test("falls back to estimatedValue when estimatePrice is null", () => {
    expect(effectiveValue(heldCard({ estimatePrice: null, estimatedValue: 150 }))).toBe(150);
  });

  // Un-backfilled card — every value field absent. UI must render gracefully
  // (no exception, returns null so callers can render placeholder).
  test("all-null held card returns null without throwing", () => {
    const allNull = {
      id: "h-empty", myCost: null, manualPrice: null,
      estimatePrice: null, estimatedValue: null, avgSalePrice: null,
    };
    expect(() => effectiveValue(allNull)).not.toThrow();
    expect(effectiveValue(allNull)).toBeNull();
    expect(() => cardPnl(allNull)).not.toThrow();
    expect(cardPnl(allNull)).toBeNull();
  });
});

describe("confidenceLabel", () => {
  test("maps to Low / Medium / High per MASTER §1.5 thresholds", () => {
    expect(confidenceLabel(0)).toBe("Low");
    expect(confidenceLabel(0.4017)).toBe("Low");        // observed Mahomes Blue Wave value
    expect(confidenceLabel(0.499)).toBe("Low");
    expect(confidenceLabel(0.5)).toBe("Medium");
    expect(confidenceLabel(0.666)).toBe("Medium");      // observed Ohtani value
    expect(confidenceLabel(0.749)).toBe("Medium");
    expect(confidenceLabel(0.75)).toBe("High");
    expect(confidenceLabel(0.9)).toBe("High");
    expect(confidenceLabel(1)).toBe("High");
  });

  test("returns null when confidence is missing", () => {
    expect(confidenceLabel(null)).toBeNull();
    expect(confidenceLabel(undefined)).toBeNull();
  });
});

describe("cardPnl", () => {
  test("computes value - cost when both present", () => {
    expect(cardPnl(heldCard())).toBe(50);
    expect(cardPnl(soldCard())).toBe(40);
  });

  test("uses sellersNet over soldPrice for realized P&L when present", () => {
    // Cost 80, sold 120 gross, fee deducted → collector pockets 100.
    // Realized P&L should be 100 - 80 = 20, not 120 - 80 = 40.
    expect(cardPnl(soldCard({ sellersNet: 100 }))).toBe(20);
  });

  test("returns null when myCost or value missing", () => {
    expect(cardPnl({ estimatedValue: 100 })).toBeNull();
    expect(cardPnl({ myCost: 100 })).toBeNull();
  });

  test("can be negative (loss)", () => {
    expect(cardPnl(heldCard({ myCost: 200, estimatedValue: 150 }))).toBe(-50);
  });
});

describe("summarizePortfolio", () => {
  test("rolls up realized + unrealized correctly", () => {
    const s = summarizePortfolio([
      heldCard({ myCost: 100, estimatedValue: 150 }), // +50 unrealized
      heldCard({ id: "h2", myCost: 80, estimatedValue: 60 }), // -20 unrealized
      soldCard({ myCost: 80, consignmentSoldPrice: 120 }), // +40 realized (no fee)
    ]);
    expect(s.realizedPnl).toBe(40);
    expect(s.unrealizedPnl).toBe(30);
    expect(s.totalPnl).toBe(70);
    expect(s.totalInvested).toBe(260); // 100 + 80 + 80
    expect(s.totalValue).toBe(330);    // 150 + 60 + 120
    expect(s.heldCount).toBe(2);
    expect(s.soldCount).toBe(1);
  });

  test("realized roll-up uses sellersNet when present", () => {
    const s = summarizePortfolio([
      // Gross 120, collector pockets 100 → realized P&L = 100 - 80 = 20
      soldCard({ myCost: 80, consignmentSoldPrice: 120, sellersNet: 100 }),
    ]);
    expect(s.realizedValue).toBe(100); // not 120
    expect(s.realizedPnl).toBe(20);    // not 40
    expect(s.totalValue).toBe(100);
  });

  test("realized roll-up includes self-sold cards using soldPrice", () => {
    const s = summarizePortfolio([
      selfSoldCard({ myCost: 80, soldPrice: 130 }),                              // +50 realized
      soldCard({ myCost: 80, consignmentSoldPrice: 120, sellersNet: 100 }),      // +20 realized
    ]);
    expect(s.realizedValue).toBe(230); // 130 + 100
    expect(s.realizedPnl).toBe(70);    // 50 + 20
    expect(s.soldCount).toBe(2);
  });

  test("excludes cards without cost from invested totals", () => {
    const s = summarizePortfolio([
      heldCard({ myCost: null, estimatedValue: 200 }), // no cost
      heldCard({ myCost: 50, estimatedValue: 100 }),
    ]);
    expect(s.totalInvested).toBe(50);
    // unrealizedValue still includes cards without cost (we know what they're worth)
    expect(s.unrealizedValue).toBe(300);
    // unrealizedPnl only uses cards where BOTH cost and value are known
    expect(s.unrealizedPnl).toBe(50);
  });

  test("returns zeroed shape on empty / non-array input", () => {
    expect(summarizePortfolio([]).totalPnl).toBe(0);
    expect(summarizePortfolio(null).totalPnl).toBe(0);
    expect(summarizePortfolio(undefined).heldCount).toBe(0);
  });

  test("hasSoldCost / hasHeldCost flags reflect whether any row had cost", () => {
    const s = summarizePortfolio([heldCard({ myCost: null, estimatedValue: 100 })]);
    expect(s.hasHeldCost).toBe(false);
    expect(s.hasSoldCost).toBe(false);
  });

  // Valuation rebuild: unrealized roll-up uses the same precedence as
  // effectiveValue (manualPrice ?? estimatePrice ?? estimatedValue).
  test("unrealized roll-up prefers estimatePrice over estimatedValue", () => {
    const s = summarizePortfolio([
      heldCard({ myCost: 100, estimatePrice: 175, estimatedValue: 150 }), // +75
    ]);
    expect(s.unrealizedValue).toBe(175);
    expect(s.unrealizedPnl).toBe(75);
  });

  test("all-null cards roll up to zero without throwing", () => {
    const allNull = {
      id: "h-empty", myCost: null, manualPrice: null,
      estimatePrice: null, estimatedValue: null,
    };
    expect(() => summarizePortfolio([allNull])).not.toThrow();
    const s = summarizePortfolio([allNull]);
    expect(s.heldCount).toBe(1);
    expect(s.unrealizedValue).toBe(0);
    expect(s.unrealizedPnl).toBe(0);
    expect(s.totalPnl).toBe(0);
  });
});
