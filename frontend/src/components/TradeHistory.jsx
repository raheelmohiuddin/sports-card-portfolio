import { useState } from "react";
import { fmtUsd } from "../utils/format.js";

// ── Past Trades section ────────────────────────────────────────────────
// Reverse-chronological list of executed trades. Each row collapses to a
// summary (date · given chips · received chips · net P&L) and expands on
// click into the full per-card detail. Trade-time snapshots are read from
// trade_cards so the history stays accurate even if the live cards table
// changes later.
export default function TradeHistory({ trades, loading, error }) {
  return (
    <section style={st.historySection}>
      <div style={st.historyHeader}>
        <p style={st.eyebrow}><span style={st.dot} /> Past Trades</p>
        <span style={st.historyCount}>
          {loading ? "…" : trades.length}
        </span>
      </div>

      {loading ? (
        <div style={st.historyEmpty}>Loading trade history…</div>
      ) : error ? (
        <div style={{ ...st.historyEmpty, color: "#f87171" }}>Error: {error}</div>
      ) : trades.length === 0 ? (
        <div style={st.historyEmpty}>
          You haven't executed any trades yet. Past trades will appear here.
        </div>
      ) : (
        <div style={st.historyList}>
          {trades.map((t) => (
            <TradeHistoryRow key={t.id} trade={t} />
          ))}
        </div>
      )}
    </section>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric",
});

function TradeHistoryRow({ trade }) {
  const [expanded, setExpanded] = useState(false);
  const date = trade.tradedAt ? dateFmt.format(new Date(trade.tradedAt)) : "—";
  const pnlPositive = trade.netPnl >= 0;
  const pnlColor    = Math.abs(trade.netPnl) < 0.01 ? "#94a3b8" : (pnlPositive ? "#10b981" : "#f87171");

  return (
    <div style={st.historyRow}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={st.historyRowSummary}
        aria-expanded={expanded}
      >
        <div style={st.historyDate}>{date}</div>

        <div style={st.historyMain}>
          <div style={st.historySide}>
            <span style={st.tradedBadge}>TRADED</span>
            {trade.given.length === 0 ? (
              <span style={st.historyChipsEmpty}>—</span>
            ) : (
              <div style={st.historyChips}>
                {trade.given.map((c, i) => (
                  <span key={`g${i}`} style={st.historyChip}>
                    {c.playerName ?? "Unknown"}
                    {c.grade && <span style={st.historyChipGrade}> · {c.grade}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          <span style={st.historyArrow}>⇄</span>

          <div style={st.historySide}>
            <span style={st.receivedBadge}>RECEIVED</span>
            {trade.received.length === 0 ? (
              <span style={st.historyChipsEmpty}>—</span>
            ) : (
              <div style={st.historyChips}>
                {trade.received.map((c, i) => (
                  <span key={`r${i}`} style={st.historyChip}>
                    {c.playerName ?? "Unknown"}
                    {c.grade && <span style={st.historyChipGrade}> · {c.grade}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={st.historyRight}>
          {(trade.cashGiven > 0 || trade.cashReceived > 0) && (
            <div style={st.historyCashSummary}>
              {trade.cashReceived > 0 && (
                <span style={st.historyCashIn}>+{fmtUsd(trade.cashReceived)}</span>
              )}
              {trade.cashGiven > 0 && (
                <span style={st.historyCashOut}>−{fmtUsd(trade.cashGiven)}</span>
              )}
            </div>
          )}
          <div style={{ ...st.historyPnl, color: pnlColor }}>
            {Math.abs(trade.netPnl) < 0.01
              ? "Even"
              : `${pnlPositive ? "+" : "−"}${fmtUsd(Math.abs(trade.netPnl))}`}
          </div>
          <span style={{ ...st.historyChevron, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▾
          </span>
        </div>
      </button>

      {expanded && (
        <div style={st.historyDetail}>
          <TradeDetailColumn label="Cards Traded Away" cards={trade.given} side="given" />
          <TradeDetailColumn label="Cards Received"    cards={trade.received} side="received" />
          {(trade.cashGiven > 0 || trade.cashReceived > 0 || trade.notes) && (
            <div style={st.historyDetailFooter}>
              {trade.cashGiven > 0 && (
                <div style={st.historyDetailRow}>
                  <span style={st.historyDetailLabel}>Cash Given</span>
                  <span style={st.historyDetailValue}>−{fmtUsd(trade.cashGiven)}</span>
                </div>
              )}
              {trade.cashReceived > 0 && (
                <div style={st.historyDetailRow}>
                  <span style={st.historyDetailLabel}>Cash Received</span>
                  <span style={st.historyDetailValue}>+{fmtUsd(trade.cashReceived)}</span>
                </div>
              )}
              {trade.notes && (
                <div style={st.historyDetailRow}>
                  <span style={st.historyDetailLabel}>Notes</span>
                  <span style={st.historyDetailNotes}>{trade.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeDetailColumn({ label, cards, side }) {
  if (cards.length === 0) {
    return (
      <div style={st.historyDetailCol}>
        <div style={st.historyDetailColLabel}>{label}</div>
        <div style={st.historyDetailColEmpty}>No cards on this side.</div>
      </div>
    );
  }
  return (
    <div style={st.historyDetailCol}>
      <div style={st.historyDetailColLabel}>{label}</div>
      <div style={st.historyDetailCardList}>
        {cards.map((c, i) => (
          <div key={i} style={st.historyDetailCard}>
            <div style={st.historyDetailCardMain}>
              <div style={st.historyDetailCardPlayer}>{c.playerName ?? "Unknown"}</div>
              <div style={st.historyDetailCardMeta}>
                {[c.year, c.brand, c.grade ? `PSA ${c.grade}` : null].filter(Boolean).join(" · ")}
              </div>
              {c.certNumber && <div style={st.historyDetailCardCert}>Cert {c.certNumber}</div>}
            </div>
            <div style={st.historyDetailCardFinance}>
              {side === "given" ? (
                <>
                  <span style={st.historyDetailFinLabel}>Cost basis</span>
                  <span style={st.historyDetailFinValue}>{fmtUsd(c.allocatedCost)}</span>
                </>
              ) : (
                <>
                  <span style={st.historyDetailFinLabel}>Trade-time value</span>
                  <span style={st.historyDetailFinValue}>{fmtUsd(c.estimatedValue)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const st = {
  // Eyebrow + dot — used by the section header.
  eyebrow: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.18em",
    textTransform: "uppercase", color: "#fbbf24", margin: 0,
  },
  dot: {
    width: 8, height: 8, borderRadius: "50%",
    background: "#f59e0b",
    boxShadow: "0 0 8px rgba(245,158,11,0.8)",
  },

  // ── Past Trades section ──
  historySection: {
    marginTop: "1rem",
    paddingTop: "1.5rem",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    display: "flex", flexDirection: "column", gap: "1rem",
  },
  historyHeader: {
    display: "flex", alignItems: "center", gap: "0.75rem",
  },
  historyCount: {
    background: "rgba(245,158,11,0.15)",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#fbbf24",
    fontSize: "0.7rem", fontWeight: 800,
    padding: "0.1rem 0.55rem", borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  },
  historyEmpty: {
    color: "#64748b", fontSize: "0.85rem",
    fontStyle: "italic", textAlign: "center",
    padding: "2rem 1rem",
    background: "rgba(255,255,255,0.02)",
    border: "1px dashed rgba(255,255,255,0.08)",
    borderRadius: 12,
  },
  historyList: {
    display: "flex", flexDirection: "column", gap: "0.6rem",
  },
  historyRow: {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    overflow: "hidden",
    transition: "border-color 0.15s ease, background 0.15s ease",
  },
  historyRowSummary: {
    display: "grid",
    gridTemplateColumns: "120px 1fr auto",
    gap: "1.25rem",
    alignItems: "center",
    width: "100%",
    background: "transparent",
    border: "none",
    padding: "1rem 1.1rem",
    cursor: "pointer",
    color: "#e2e8f0",
    textAlign: "left",
    fontFamily: "inherit",
  },
  historyDate: {
    fontSize: "0.78rem", fontWeight: 700,
    color: "#94a3b8",
    letterSpacing: "0.04em",
    fontVariantNumeric: "tabular-nums",
  },
  historyMain: {
    display: "flex", alignItems: "center", gap: "0.75rem",
    minWidth: 0,
  },
  historySide: {
    display: "flex", alignItems: "center", gap: "0.55rem",
    flex: 1, minWidth: 0,
  },
  historyChips: {
    display: "flex", flexWrap: "wrap", gap: "0.3rem",
    minWidth: 0,
  },
  historyChip: {
    fontSize: "0.78rem", color: "#e2e8f0",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    padding: "0.18rem 0.5rem",
    borderRadius: 6,
    whiteSpace: "nowrap",
  },
  historyChipGrade: {
    color: "#94a3b8", fontWeight: 600,
  },
  historyChipsEmpty: {
    color: "#64748b", fontSize: "0.78rem", fontStyle: "italic",
  },
  historyArrow: {
    color: "#475569", fontSize: "1rem",
    flexShrink: 0,
  },
  tradedBadge: {
    fontSize: "0.62rem", fontWeight: 800,
    letterSpacing: "0.12em",
    background: "rgba(245,158,11,0.18)",
    border: "1px solid rgba(245,158,11,0.45)",
    color: "#fbbf24",
    padding: "0.18rem 0.45rem",
    borderRadius: 4,
    flexShrink: 0,
  },
  receivedBadge: {
    fontSize: "0.62rem", fontWeight: 800,
    letterSpacing: "0.12em",
    background: "rgba(16,185,129,0.15)",
    border: "1px solid rgba(16,185,129,0.4)",
    color: "#34d399",
    padding: "0.18rem 0.45rem",
    borderRadius: 4,
    flexShrink: 0,
  },
  historyRight: {
    display: "flex", alignItems: "center", gap: "0.85rem",
    flexShrink: 0,
  },
  historyCashSummary: {
    display: "flex", flexDirection: "column",
    alignItems: "flex-end", gap: "0.1rem",
    fontSize: "0.7rem",
    fontVariantNumeric: "tabular-nums",
  },
  historyCashIn:  { color: "#34d399", fontWeight: 700 },
  historyCashOut: { color: "#fbbf24", fontWeight: 700 },
  historyPnl: {
    fontSize: "0.95rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
    minWidth: 80, textAlign: "right",
  },
  historyChevron: {
    color: "#64748b", fontSize: "0.8rem",
    transition: "transform 0.2s ease",
    width: 14, textAlign: "center",
  },

  // Expanded detail panel
  historyDetail: {
    borderTop: "1px solid rgba(255,255,255,0.06)",
    padding: "1.25rem",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
    background: "rgba(0,0,0,0.2)",
  },
  historyDetailCol: {
    display: "flex", flexDirection: "column", gap: "0.6rem",
    minWidth: 0,
  },
  historyDetailColLabel: {
    fontSize: "0.66rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#94a3b8",
    paddingBottom: "0.4rem",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  historyDetailColEmpty: {
    color: "#64748b", fontSize: "0.8rem", fontStyle: "italic",
  },
  historyDetailCardList: {
    display: "flex", flexDirection: "column", gap: "0.5rem",
  },
  historyDetailCard: {
    display: "flex", justifyContent: "space-between",
    gap: "0.85rem",
    padding: "0.7rem 0.85rem",
    background: "#0b1220",
    border: "1px solid rgba(255,255,255,0.04)",
    borderRadius: 8,
  },
  historyDetailCardMain: { minWidth: 0, flex: 1 },
  historyDetailCardPlayer: {
    fontSize: "0.88rem", fontWeight: 700, color: "#f1f5f9",
  },
  historyDetailCardMeta: {
    fontSize: "0.74rem", color: "#94a3b8", marginTop: "0.15rem",
  },
  historyDetailCardCert: {
    fontSize: "0.66rem", color: "#64748b",
    marginTop: "0.2rem",
    fontVariantNumeric: "tabular-nums",
  },
  historyDetailCardFinance: {
    display: "flex", flexDirection: "column",
    alignItems: "flex-end", justifyContent: "center",
    gap: "0.1rem",
    flexShrink: 0,
  },
  historyDetailFinLabel: {
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    color: "#64748b",
  },
  historyDetailFinValue: {
    fontSize: "0.92rem", fontWeight: 800, color: "#f1f5f9",
    fontVariantNumeric: "tabular-nums",
  },
  historyDetailFooter: {
    gridColumn: "1 / -1",
    paddingTop: "1rem",
    borderTop: "1px solid rgba(255,255,255,0.05)",
    display: "flex", flexDirection: "column", gap: "0.4rem",
  },
  historyDetailRow: {
    display: "flex", justifyContent: "space-between",
    fontSize: "0.82rem",
  },
  historyDetailLabel: {
    color: "#94a3b8", fontWeight: 600,
  },
  historyDetailValue: {
    color: "#f1f5f9", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  historyDetailNotes: {
    color: "#cbd5e1", fontStyle: "italic",
    textAlign: "right",
    maxWidth: "60%",
  },
};
