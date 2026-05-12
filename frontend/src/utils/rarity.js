// Tiered rarity logic used across the portfolio page, card modal, and analytics.
// All three tiers require psaPopulationHigher === 0 — i.e. nobody has been
// graded higher than this card. The tiers split on the total population:
//   ghost       — pop ≤ 5   (the rarest)
//   ultra_rare  — pop 6–25
//   rare        — pop 26–50
// Cards with higher !== 0 OR pop > 50 OR missing pop data return null.
export function getRarityTier(card) {
  if (!card) return null;
  if (card.psaPopulationHigher !== 0) return null;
  const pop = card.psaPopulation;
  if (pop == null) return null;
  if (pop <= 5)  return "ghost";
  if (pop <= 25) return "ultra_rare";
  if (pop <= 50) return "rare";
  return null;
}

export const TIER_LABELS = {
  ghost:      "GHOST",
  ultra_rare: "ULTRA RARE",
  rare:       "RARE",
};

// Primary accent colour per tier — used for borders, glows, text.
export const TIER_COLORS = {
  ghost:      "#e2e8f0", // silvery white (slate-200)
  ultra_rare: "#f59e0b", // gold (amber-500)
  rare:       "#93c5fd", // icy blue silver (blue-300)
};
