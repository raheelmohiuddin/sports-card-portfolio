// Trade Builder math helpers — kept pure so they're unit-testable in
// isolation. The TradeTab component imports these and applies the result
// to its summary bar / allocation screen.

// Total cost basis for a trade. The user starts with the cost of every
// card they're giving away, gets credited for any cash they receive,
// and pays for any cash they add. Floored at 0 — a "negative cost
// basis" makes no semantic sense (the user can't allocate negative
// dollars across received cards).
//
// Inputs are tolerant of null/undefined/empty cost so calling code
// doesn't have to pre-filter — missing cost contributes 0.
export function computeTradeCostBasis(givenCards, cashGiven, cashReceived) {
  const safe = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const cards = Array.isArray(givenCards) ? givenCards : [];
  const givenCostSum = cards.reduce((sum, c) => sum + safe(c?.myCost), 0);
  return Math.max(0, givenCostSum - safe(cashReceived) + safe(cashGiven));
}
