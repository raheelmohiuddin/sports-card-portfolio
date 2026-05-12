// Pre-confirm modal — shown when the user clicks Confirm Trade in the
// allocation step. Surfaces the irreversibility ("cannot be undone") and
// a per-card summary of what's about to happen so they don't fire
// confirm-cost on autopilot.
//
// Card lists are individually scroll-capped so 10+ cards on a side
// don't push the actions bar off-screen. Sections render even when
// empty so the structure stays predictable across one-sided trades.

// "{year} {brand} {playerName} #{cardNumber}". Missing fields are
// dropped silently (e.g. a card with no cardNumber renders without the
// "#" segment). Grade is rendered separately so it can be styled as
// muted meta-text after the dash.
function cardTitle(card) {
  return [
    card.year,
    card.brand,
    card.playerName,
    card.cardNumber ? `#${card.cardNumber}` : null,
  ].filter(Boolean).join(" ");
}

export default function ConfirmModal({ givenCards, receivedCards, netCashFlow, onCancel, onConfirm }) {
  const cashLine =
    Math.abs(netCashFlow) < 0.01
      ? "No cash on either side"
      : netCashFlow > 0
        ? `+$${netCashFlow.toFixed(2)} net cash to you`
        : `−$${Math.abs(netCashFlow).toFixed(2)} net cash from you`;

  return (
    <div style={st.modalOverlay} onClick={onCancel} role="dialog" aria-modal="true" aria-label="Confirm trade">
      <div style={st.modalDialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={st.modalTitle}>Confirm Trade</h3>
        <p style={st.modalBody}>
          Once executed, this trade cannot be undone. Please review your
          trade details before proceeding.
        </p>
        <div style={st.modalSummary}>
          <div style={st.modalCardSection}>
            <div style={st.modalSectionLabel}>
              Trading Away <span style={st.modalSectionCount}>({givenCards.length})</span>
            </div>
            <ul style={st.modalCardList}>
              {givenCards.map((c) => (
                <li key={c.id} style={st.modalCardItem}>
                  <span style={st.modalCardBullet}>•</span>
                  <span style={st.modalCardName} title={cardTitle(c)}>{cardTitle(c)}</span>
                  <span style={st.modalCardSep}>—</span>
                  <span style={st.modalCardGrade}>PSA {c.grade ?? "?"}</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={st.modalCardSection}>
            <div style={st.modalSectionLabel}>
              Receiving <span style={st.modalSectionCount}>({receivedCards.length})</span>
            </div>
            <ul style={st.modalCardList}>
              {receivedCards.map((r) => (
                <li key={r.certNumber} style={st.modalCardItem}>
                  <span style={st.modalCardBullet}>•</span>
                  <span style={st.modalCardName} title={cardTitle(r)}>{cardTitle(r)}</span>
                  <span style={st.modalCardSep}>—</span>
                  <span style={st.modalCardGrade}>PSA {r.grade ?? "?"}</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={st.modalSummaryRow}>
            <span style={st.modalSummaryLabel}>Net cash flow</span>
            <span style={st.modalSummaryValue}>{cashLine}</span>
          </div>
        </div>
        <div style={st.modalActions}>
          <button type="button" onClick={onCancel} style={st.modalCancelBtn}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} style={st.modalConfirmBtn}>
            Yes, Execute Trade
          </button>
        </div>
      </div>
    </div>
  );
}

const st = {
  // ── Confirm modal ──
  // Backdrop blocks clicks behind it. Clicking the backdrop dismisses
  // (mirrors common modal UX); the dialog itself stops propagation so
  // a click inside doesn't close it. Centered with flex so the dialog
  // self-sizes without us having to compute offsets.
  modalOverlay: {
    position: "fixed", inset: 0, zIndex: 2000,
    background: "rgba(2,6,23,0.78)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "1rem",
  },
  modalDialog: {
    width: "100%",
    maxWidth: 460,
    background: "linear-gradient(180deg, #131c33, #0a1124)",
    border: "1px solid rgba(245,158,11,0.25)",
    borderRadius: 16,
    padding: "1.75rem 1.85rem 1.5rem",
    boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.08)",
    color: "#e2e8f0",
  },
  modalTitle: {
    fontSize: "1.25rem", fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "#f1f5f9",
    margin: "0 0 0.65rem",
  },
  modalBody: {
    fontSize: "0.9rem", color: "#94a3b8",
    lineHeight: 1.55,
    margin: "0 0 1.25rem",
  },
  modalSummary: {
    display: "flex", flexDirection: "column",
    gap: "0.55rem",
    padding: "0.95rem 1.1rem",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    marginBottom: "1.5rem",
  },
  modalSummaryRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    fontSize: "0.85rem",
  },
  modalSummaryLabel: {
    color: "#94a3b8", fontWeight: 600,
    letterSpacing: "0.04em",
  },
  modalSummaryValue: {
    color: "#f1f5f9", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // Per-side card section. Header is the eyebrow ("TRADING AWAY (3)"),
  // followed by a vertical list of slim card rows. The list scrolls
  // independently so a 20-card trade doesn't push the actions bar
  // off-screen.
  modalCardSection: {
    display: "flex", flexDirection: "column",
    gap: "0.4rem",
  },
  modalSectionLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#fbbf24",
  },
  modalSectionCount: {
    color: "#94a3b8", fontWeight: 600,
    marginLeft: "0.25rem",
  },
  modalCardList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: 132, // ~4 rows visible before scrolling
    overflowY: "auto",
    display: "flex", flexDirection: "column",
    gap: "0.25rem",
  },
  modalCardItem: {
    display: "flex", alignItems: "baseline",
    gap: "0.4rem",
    fontSize: "0.82rem",
    color: "#e2e8f0",
    padding: "0.15rem 0",
    minWidth: 0,
  },
  modalCardBullet: {
    color: "#f59e0b", fontWeight: 800,
    flexShrink: 0,
  },
  modalCardName: {
    fontWeight: 700, color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    minWidth: 0, flex: "0 1 auto",
  },
  modalCardSep: {
    color: "#475569",
    flexShrink: 0,
  },
  modalCardGrade: {
    color: "#94a3b8", fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  modalActions: {
    display: "flex", gap: "0.75rem",
    justifyContent: "flex-end",
  },
  modalCancelBtn: {
    padding: "0.75rem 1.4rem",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid rgba(248,113,113,0.45)",
    color: "#fca5a5",
    fontSize: "0.88rem", fontWeight: 700,
    letterSpacing: "0.03em",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  modalConfirmBtn: {
    padding: "0.75rem 1.5rem",
    borderRadius: 8,
    background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
    color: "#0f172a",
    border: "none",
    fontSize: "0.88rem", fontWeight: 800,
    letterSpacing: "0.03em",
    cursor: "pointer",
    boxShadow: "0 6px 18px rgba(245,158,11,0.3), 0 0 0 1px rgba(245,158,11,0.45)",
  },
};
