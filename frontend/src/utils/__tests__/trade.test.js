import { describe, test, expect } from "vitest";
import { computeTradeCostBasis } from "../trade.js";

describe("computeTradeCostBasis", () => {
  test("sums cost of given cards when no cash is involved", () => {
    expect(computeTradeCostBasis(
      [{ myCost: 100 }, { myCost: 50 }],
      0,
      0
    )).toBe(150);
  });

  test("subtracts received cash and adds given cash", () => {
    // I trade $200 in cards + $20 cash for someone else's cards.
    // My cost basis going into this trade = 200 + 20 = 220.
    expect(computeTradeCostBasis(
      [{ myCost: 200 }],
      20,
      0
    )).toBe(220);

    // I trade $200 in cards and receive $50 cash.
    // My cost basis = 200 - 50 = 150.
    expect(computeTradeCostBasis(
      [{ myCost: 200 }],
      0,
      50
    )).toBe(150);
  });

  test("floors at zero — cost basis can't go negative", () => {
    expect(computeTradeCostBasis(
      [{ myCost: 50 }],
      0,
      200
    )).toBe(0);
  });

  test("ignores missing/null myCost without throwing", () => {
    expect(computeTradeCostBasis(
      [{ myCost: null }, { myCost: 100 }, {}],
      0,
      0
    )).toBe(100);
  });

  test("treats invalid cash inputs as 0", () => {
    expect(computeTradeCostBasis([{ myCost: 100 }], "abc", null)).toBe(100);
    expect(computeTradeCostBasis([{ myCost: 100 }], NaN, undefined)).toBe(100);
  });

  test("returns 0 when given cards is empty / non-array", () => {
    expect(computeTradeCostBasis([], 0, 0)).toBe(0);
    expect(computeTradeCostBasis(null, 0, 0)).toBe(0);
    expect(computeTradeCostBasis(undefined, 50, 0)).toBe(50); // pure cash given
  });

  test("real-world example: 3 cards at $100 each + $40 cash given, $30 cash received", () => {
    // Net cost basis = 300 + 40 - 30 = 310
    expect(computeTradeCostBasis(
      [{ myCost: 100 }, { myCost: 100 }, { myCost: 100 }],
      40,
      30
    )).toBe(310);
  });
});
