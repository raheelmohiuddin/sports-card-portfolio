import { describe, test, expect } from "vitest";
import { getRarityTier, TIER_LABELS, TIER_COLORS } from "../rarity.js";

describe("getRarityTier", () => {
  test("returns null when psaPopulationHigher is non-zero (someone graded higher)", () => {
    expect(getRarityTier({ psaPopulation: 1, psaPopulationHigher: 1 })).toBeNull();
    expect(getRarityTier({ psaPopulation: 5, psaPopulationHigher: 100 })).toBeNull();
  });

  test("returns null when pop data is missing", () => {
    expect(getRarityTier({ psaPopulationHigher: 0 })).toBeNull();
    expect(getRarityTier({ psaPopulation: null, psaPopulationHigher: 0 })).toBeNull();
  });

  test("ghost tier: pop ≤ 5", () => {
    expect(getRarityTier({ psaPopulation: 1, psaPopulationHigher: 0 })).toBe("ghost");
    expect(getRarityTier({ psaPopulation: 5, psaPopulationHigher: 0 })).toBe("ghost");
  });

  test("ultra_rare tier: pop 6–25", () => {
    expect(getRarityTier({ psaPopulation: 6,  psaPopulationHigher: 0 })).toBe("ultra_rare");
    expect(getRarityTier({ psaPopulation: 25, psaPopulationHigher: 0 })).toBe("ultra_rare");
  });

  test("rare tier: pop 26–50", () => {
    expect(getRarityTier({ psaPopulation: 26, psaPopulationHigher: 0 })).toBe("rare");
    expect(getRarityTier({ psaPopulation: 50, psaPopulationHigher: 0 })).toBe("rare");
  });

  test("returns null for pop > 50", () => {
    expect(getRarityTier({ psaPopulation: 51,   psaPopulationHigher: 0 })).toBeNull();
    expect(getRarityTier({ psaPopulation: 9999, psaPopulationHigher: 0 })).toBeNull();
  });

  test("returns null for null/undefined input", () => {
    expect(getRarityTier(null)).toBeNull();
    expect(getRarityTier(undefined)).toBeNull();
  });
});

describe("TIER_LABELS / TIER_COLORS", () => {
  test("every tier returned by getRarityTier has a label and color", () => {
    for (const tier of ["ghost", "ultra_rare", "rare"]) {
      expect(TIER_LABELS[tier]).toBeTruthy();
      expect(TIER_COLORS[tier]).toMatch(/^#[0-9a-f]{3,6}$/i);
    }
  });
});
