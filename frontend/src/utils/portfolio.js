// Shared P&L helpers — kept in one place so the hero panel, per-card tiles,
// CardModal sidebar, and analytics row all derive realized vs unrealized
// the same way. The bias here is: a SOLD card with a sold_price recorded
// is treated as a realized exit; everything else (including listed but
// not yet sold, declined, or never consigned) is unrealized.

// Has the card been actually sold and the admin entered a sold price?
export function isSold(card) {
  return card?.consignmentStatus === "sold" && card?.consignmentSoldPrice != null;
}

// Card was traded away in a /trades/execute call. Surfaced via the cards
// table's status column. Same exit semantics as sold; rendered in the
// Collection History tab with a TRADED badge so the user keeps history.
export function isTraded(card) {
  return card?.status === "traded";
}

// The "value" we report for a card today.
//   sold (with price)  → soldPrice  (the realized exit)
//   anything else      → estimatedValue (manual override or auto market)
// Falls back to null when neither is available.
export function effectiveValue(card) {
  if (!card) return null;
  if (isSold(card)) return card.consignmentSoldPrice;
  return card.estimatedValue ?? null;
}

// Per-card P&L vs cost. null when myCost or value is missing.
export function cardPnl(card) {
  if (card?.myCost == null) return null;
  const v = effectiveValue(card);
  if (v == null) return null;
  return v - card.myCost;
}

// Aggregate roll-up across an array of cards.
//   realizedPnl    = sum of (soldPrice - myCost) for sold cards with cost
//   unrealizedPnl  = sum of (estimatedValue - myCost) for non-sold cards with cost
//   totalPnl       = realized + unrealized
//   realizedValue  = sum of sold prices (your realized cash-out)
//   unrealizedValue = sum of estimated values for non-sold cards
//   totalValue     = realizedValue + unrealizedValue
//   investedSold / investedHeld = matching cost basis splits
export function summarizePortfolio(cards) {
  const out = {
    realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0,
    realizedValue: 0, unrealizedValue: 0, totalValue: 0,
    investedSold: 0, investedHeld: 0, totalInvested: 0,
    soldCount: 0, heldCount: 0,
    hasSoldCost: false, hasHeldCost: false,
  };
  if (!Array.isArray(cards)) return out;

  for (const c of cards) {
    const cost = c.myCost ?? null;
    if (isSold(c)) {
      out.soldCount += 1;
      out.realizedValue += c.consignmentSoldPrice;
      if (cost != null) {
        out.investedSold += cost;
        out.realizedPnl  += c.consignmentSoldPrice - cost;
        out.hasSoldCost = true;
      }
    } else {
      out.heldCount += 1;
      const v = c.estimatedValue ?? null;
      if (v != null) out.unrealizedValue += v;
      if (cost != null && v != null) {
        out.investedHeld  += cost;
        out.unrealizedPnl += v - cost;
        out.hasHeldCost = true;
      }
    }
  }

  out.totalValue    = out.realizedValue + out.unrealizedValue;
  out.totalInvested = out.investedSold + out.investedHeld;
  out.totalPnl      = out.realizedPnl + out.unrealizedPnl;

  return out;
}
