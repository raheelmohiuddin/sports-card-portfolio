// Shared P&L helpers — kept in one place so the hero panel, per-card tiles,
// CardModal sidebar, and analytics row all derive realized vs unrealized
// the same way. The bias here is: a SOLD card with a sold_price recorded
// is treated as a realized exit; everything else (including listed but
// not yet sold, declined, or never consigned) is unrealized.

// Has the card been actually sold? Two paths produce a sold card today:
//   - consignment-sold: an admin moved a consignments row to status='sold'
//     and entered a sold price (platform-mediated exit).
//   - self-sold: the user recorded the sale themselves via Mark as Sold
//     (cards.status='sold' with sold_price set; see mark-as-sold-plan.md).
// Either branch satisfies isSold. effectiveValue + summarizePortfolio
// each check the discriminator (card.status === "sold") to pick the
// right realized number, since self-sold has no platform fee / no
// sellers_net concept.
export function isSold(card) {
  if (!card) return false;
  if (card.status === "sold" && card.soldPrice != null) return true;
  if (card.consignmentStatus === "sold" && card.consignmentSoldPrice != null) return true;
  return false;
}

// Card was traded away in a /trades/execute call. Surfaced via the cards
// table's status column. Same exit semantics as sold; rendered in the
// Collection History tab with a TRADED badge so the user keeps history.
export function isTraded(card) {
  return card?.status === "traded";
}

// The "value" we report for a card today.
//   self-sold              → soldPrice (no platform fee — the user handled
//                              the sale themselves; what they entered IS the
//                              realized exit)
//   consignment-sold (fee) → sellersNet (what the collector pocketed after
//                              the consignment fee — the true realized exit
//                              for P&L purposes)
//   consignment-sold       → consignmentSoldPrice (gross; legacy/pre-fee
//   (legacy/no fee)            schema and sales where admin hasn't entered
//                              a fee yet)
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
  if (isSold(card)) {
    // Self-sold first: the user entered sold_price directly, no platform
    // fee / sellers_net applies. If a card somehow carries both signals
    // (cards.status='sold' AND a stale consignment row), self-sold wins
    // since it's the more recent action by the user.
    if (card.status === "sold" && card.soldPrice != null) return card.soldPrice;
    return card.sellersNet ?? card.consignmentSoldPrice;
  }
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
      // Realized cash-out is what the collector received. Same precedence
      // as effectiveValue for sold cards:
      //   self-sold (cards.status='sold')  → soldPrice (no platform fee)
      //   consignment with sellers_net set → sellersNet (post-fee net)
      //   consignment legacy / no fee yet  → consignmentSoldPrice (gross)
      const realized = (c.status === "sold" && c.soldPrice != null)
        ? c.soldPrice
        : (c.sellersNet ?? c.consignmentSoldPrice);
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
