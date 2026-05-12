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
//   sold (with sellers_net) → sellersNet (what the collector actually pocketed
//                              after the consignment fee — the true realized
//                              exit for P&L purposes)
//   sold (legacy / no fee)  → consignmentSoldPrice (gross; used pre-fee schema
//                              and when admin hasn't entered a fee yet)
//   held                    → manualPrice ?? estimatePrice ?? estimatedValue
//                              per OQ-4: manual override wins over auto.
//                              estimatePrice is the new price-estimate column
//                              from the valuation rebuild (see MASTER §1.5);
//                              estimatedValue is the legacy comps fallback for
//                              cards not yet refreshed under the new flow.
// avg_sale_price is intentionally NOT in the chain — refresh-portfolio.js
// writes estimated_value and avg_sale_price from the same source, so the
// two columns track identically on every refreshed card post-rebuild.
// Falls back to null when nothing is available.
export function effectiveValue(card) {
  if (!card) return null;
  if (isSold(card)) return card.sellersNet ?? card.consignmentSoldPrice;
  return card.manualPrice ?? card.estimatePrice ?? card.estimatedValue ?? null;
}

// Maps CardHedger price-estimate confidence (0.0-1.0) to a UI tier label.
// Thresholds locked in MASTER §1.5: Low <0.5 / Medium 0.5–0.75 / High ≥0.75.
// Returns null when confidence is missing so callers can render-or-skip with
// `if (label)`.
export function confidenceLabel(confidence) {
  if (confidence == null) return null;
  if (confidence < 0.5)  return "Low";
  if (confidence < 0.75) return "Medium";
  return "High";
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
      // Realized cash-out is what the collector received, not the gross sale.
      // Prefer sellers_net; fall back to soldPrice for legacy rows (consignment
      // predates the fee schema) or sales where admin hasn't entered a fee yet.
      const realized = c.sellersNet ?? c.consignmentSoldPrice;
      out.realizedValue += realized;
      if (cost != null) {
        out.investedSold += cost;
        out.realizedPnl  += realized - cost;
        out.hasSoldCost = true;
      }
    } else {
      out.heldCount += 1;
      // Same precedence as effectiveValue: manual override wins, then the
      // new estimate_price column, then the legacy estimated_value fallback.
      const v = c.manualPrice ?? c.estimatePrice ?? c.estimatedValue ?? null;
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
