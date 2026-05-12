// Currency and number formatters used across the frontend.
// Add new formatters here as needed rather than defining them inline.

// USD currency with two-decimal precision, comma group separators, and an
// em-dash placeholder for null/NaN. Used by every price column in the
// TradeDesk surfaces (TradeTab body, ConfirmModal, AnalysisModal,
// TradeHistory).
export function fmtUsd(n) {
  if (n == null || isNaN(n)) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
