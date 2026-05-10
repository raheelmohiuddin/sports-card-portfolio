import { describe, test, expect } from "vitest";
import {
  isSold,
  isTraded,
  effectiveValue,
  cardPnl,
  summarizePortfolio,
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
});

describe("effectiveValue", () => {
  test("returns soldPrice for sold cards (realized exit)", () => {
    expect(effectiveValue(soldCard())).toBe(120);
  });

  test("returns estimatedValue for held cards", () => {
    expect(effectiveValue(heldCard())).toBe(150);
  });

  test("returns null when neither is available", () => {
    expect(effectiveValue({ myCost: 100 })).toBeNull();
    expect(effectiveValue(null)).toBeNull();
  });
});

describe("cardPnl", () => {
  test("computes value - cost when both present", () => {
    expect(cardPnl(heldCard())).toBe(50);
    expect(cardPnl(soldCard())).toBe(40);
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
      soldCard({ myCost: 80, consignmentSoldPrice: 120 }), // +40 realized
    ]);
    expect(s.realizedPnl).toBe(40);
    expect(s.unrealizedPnl).toBe(30);
    expect(s.totalPnl).toBe(70);
    expect(s.totalInvested).toBe(260); // 100 + 80 + 80
    expect(s.totalValue).toBe(330);    // 150 + 60 + 120
    expect(s.heldCount).toBe(2);
    expect(s.soldCount).toBe(1);
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
});
