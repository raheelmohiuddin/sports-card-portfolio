import { useEffect, useState } from "react";
import { gradients } from "../utils/theme.js";

// Two modals for the AI Trade Analysis flow:
//   AnalysisLoadingModal — shown while POST /trades/analyze is in flight.
//                          Self-paced progress bar 0→95% over ~12s.
//   AnalysisModal        — renders the structured response. Verdict pill
//                          + confidence + per-section breakdowns.
// The loading modal hands off to the result modal once the parent passes
// the response down (via the `result` prop flipping non-null + the
// onComplete callback).

// Each new message gets a fresh React key so the keyframe animation
// replays on every change. Messages are mapped to the current progress %.
const LOADING_MESSAGES = [
  { upTo:  10, text: "Waking up the AI analyst…" },
  { upTo:  20, text: "Reviewing your card portfolio… nice pulls 👀" },
  { upTo:  30, text: "Checking recent sales data…" },
  { upTo:  40, text: "Consulting the ghost of card shows past…" },
  { upTo:  50, text: "Running predictive models… beep boop 🤖" },
  { upTo:  60, text: "Analyzing population reports…" },
  { upTo:  70, text: "Arguing with myself about short vs long term value…" },
  { upTo:  80, text: "Cross-referencing with 847 data points…" },
  { upTo:  90, text: "Drafting strongly worded opinions…" },
  { upTo:  95, text: "Almost there… putting on finishing touches ✨" },
];
const LOADING_DONE_MSG = "Analysis complete! Here's what I found 🎯";

function messageForProgress(p) {
  if (p >= 100) return LOADING_DONE_MSG;
  for (const m of LOADING_MESSAGES) {
    if (p < m.upTo) return m.text;
  }
  return LOADING_MESSAGES[LOADING_MESSAGES.length - 1].text;
}

export function AnalysisLoadingModal({ result, onComplete }) {
  const [progress, setProgress] = useState(0);
  const done = !!result;

  // Auto-progress from 0 to 95 over ~12 seconds while the request is
  // in flight. Tick every 100ms; capped at 95 so the bar never claims
  // to be finished until the response actually lands.
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setProgress((p) => Math.min(95, p + (95 / (12 * 10)))); // 95 over 12s @ 10Hz
    }, 100);
    return () => clearInterval(id);
  }, [done]);

  // When the response arrives: jump to 100%, hold briefly so the user
  // sees the celebratory finish + completion message, then hand off to
  // the result modal via onComplete.
  useEffect(() => {
    if (!done) return;
    setProgress(100);
    const t = setTimeout(() => onComplete?.(), 700);
    return () => clearTimeout(t);
  }, [done, onComplete]);

  const message = messageForProgress(progress);
  const pctLabel = Math.floor(progress);

  return (
    <div style={st.loadingBackdrop} role="dialog" aria-label="Analyzing trade" aria-live="polite">
      <div style={st.loadingPanel}>
        <div style={st.loadingSparkleWrap}>
          <span style={st.loadingSparkle} aria-hidden="true">✦</span>
        </div>

        <div style={st.loadingTitle}>TradeDesk</div>
        <div style={st.loadingSubtitle}>
          <span>Powered by</span>
          <img
            src="/claude-logo.svg"
            alt="Claude"
            style={st.loadingSubtitleLogo}
          />
        </div>

        <div style={st.loadingProgressTrack}>
          <div style={{ ...st.loadingProgressFill, width: `${progress}%` }} />
        </div>
        <div style={st.loadingProgressPct}>{pctLabel}%</div>

        <div
          key={message}
          style={st.loadingMessage}
        >
          {message}
        </div>

      </div>
    </div>
  );
}

// ── AI Trade Analysis modal ────────────────────────────────────────────
// Renders the structured response from POST /trades/analyze. Sections
// flow vertically; the verdict + confidence pill anchors the top so
// the user can scan the headline result before reading the supporting
// analysis. Esc / X / backdrop click all close.
export default function AnalysisModal({ result, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const verdictStyle =
    result.verdict === "FAVORABLE"   ? st.verdictFavorable :
    result.verdict === "UNFAVORABLE" ? st.verdictUnfavorable :
                                       st.verdictNeutral;

  const confidence = Math.max(0, Math.min(100, Math.round(result.confidence ?? 0)));

  return (
    <div
      style={st.analysisBackdrop}
      onClick={onClose}
      role="dialog"
      aria-label="Trade analysis"
    >
      <div style={st.analysisPanel} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          style={st.analysisClose}
          onClick={onClose}
          aria-label="Close analysis"
        >×</button>

        <div style={st.analysisHeader}>
          <div style={st.analysisTopRow}>
            <p style={st.eyebrow}>
              <span style={st.dot} /> AI Trade Analysis
            </p>
            <div style={st.analysisPoweredBy}>
              <span>Powered by</span>
              <img
                src="/claude-logo.svg"
                alt="Claude"
                style={st.analysisPoweredByLogo}
              />
            </div>
          </div>
          <div style={st.analysisVerdictRow}>
            <span style={{ ...st.verdictPill, ...verdictStyle }}>
              {result.verdict ?? "—"}
            </span>
            <div style={st.confidenceWrap}>
              <div style={st.confidenceLabel}>
                Confidence <span style={st.confidenceValue}>{confidence}%</span>
              </div>
              <div style={st.confidenceTrack}>
                <div style={{ ...st.confidenceFill, width: `${confidence}%` }} />
              </div>
            </div>
          </div>
        </div>

        {result.summary && (
          <p style={st.analysisSummary}>{result.summary}</p>
        )}

        <AnalysisSection title="Value Analysis"        body={result.valueAnalysis} />
        <AnalysisSection title="Short-Term Outlook (0–6 mo)"  body={result.shortTermOutlook} />
        <AnalysisSection title="Long-Term Outlook (1–3 yr)"   body={result.longTermOutlook} />
        <AnalysisSection title="Population Analysis"   body={result.populationAnalysis} />
        <AnalysisSection title="Sales Velocity"        body={result.salesVelocity} />
        <AnalysisSection title="Risk Assessment"       body={result.riskAssessment} />

        {Array.isArray(result.keyReasons) && result.keyReasons.length > 0 && (
          <>
            <div style={st.analysisSectionHead}>Key Reasons</div>
            <ul style={st.analysisReasons}>
              {result.keyReasons.map((r, i) => (
                <li key={i} style={st.analysisReasonItem}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AnalysisSection({ title, body }) {
  if (!body) return null;
  return (
    <div style={st.analysisSection}>
      <div style={st.analysisSectionHead}>{title}</div>
      <p style={st.analysisSectionBody}>{body}</p>
    </div>
  );
}

const st = {
  // Eyebrow + dot — shared by both modals' headers.
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

  // ── AI Analysis loading modal ──
  loadingBackdrop: {
    position: "fixed", inset: 0,
    background: "rgba(2, 6, 23, 0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "2rem 1rem",
    zIndex: 210, // above the result modal so it can dismiss into it
    backdropFilter: "blur(2px)",
  },
  loadingPanel: {
    width: "100%", maxWidth: 480,
    background: gradients.goldPanel,
    border: "1px solid rgba(245,158,11,0.25)",
    borderRadius: 16,
    boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.08)",
    padding: "2rem 1.75rem 1.5rem",
    textAlign: "center",
  },
  loadingSparkleWrap: {
    display: "flex", justifyContent: "center",
    marginBottom: "1.1rem",
  },
  loadingSparkle: {
    display: "inline-block",
    color: "#fbbf24",
    fontSize: "3rem",
    lineHeight: 1,
    animation: "scp-claude-sparkle 2.4s ease-in-out infinite",
  },
  loadingTitle: {
    fontSize: "1.75rem", fontWeight: 800,
    color: "#fbbf24",
    letterSpacing: "-0.01em",
    lineHeight: 1.1,
    textAlign: "center",
    textShadow: "0 0 20px rgba(245,158,11,0.35)",
  },
  // "Powered by [logo] Claude" — sits directly under TradeDesk, small
  // and muted so it reads as attribution, not a competing headline.
  loadingSubtitle: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: "0.35rem",
    marginTop: "0.4rem",
    marginBottom: "1.4rem",
    fontSize: 11,
    color: "#fff",
    opacity: 0.6,
  },
  loadingSubtitleLogo: {
    height: 12, width: "auto",
    filter: "brightness(0) invert(1)",
    display: "block",
  },
  loadingProgressTrack: {
    height: 6,
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.18)",
    borderRadius: 999,
    overflow: "hidden",
  },
  loadingProgressFill: {
    height: "100%",
    background: "linear-gradient(90deg, rgba(245,158,11,0.85), #fbbf24, #fde68a)",
    borderRadius: 999,
    boxShadow: "0 0 14px rgba(245,158,11,0.55)",
    transition: "width 0.3s ease-out",
  },
  loadingProgressPct: {
    marginTop: "0.5rem",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#fbbf24",
    letterSpacing: "0.18em",
    fontVariantNumeric: "tabular-nums",
  },
  // Each new message gets a fresh React key so the keyframe animation
  // replays on every change. minHeight prevents a layout jump as
  // text length varies between buckets.
  loadingMessage: {
    marginTop: "1.1rem",
    minHeight: "2.6rem",
    fontSize: "0.92rem",
    color: "#cbd5e1",
    lineHeight: 1.4,
    animation: "scp-msg-fade-in 0.4s ease-out",
  },

  // ── AI Analysis modal ──
  // Solid opaque panel on a near-black backdrop so the long-form text
  // reads as a premium dark card, not a translucent overlay. The
  // earlier gold-tinted gradient + 0.78 backdrop made body text fight
  // the page underneath.
  analysisBackdrop: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "2rem 1rem",
    zIndex: 200,
    overflowY: "auto",
  },
  analysisPanel: {
    position: "relative",
    width: "100%", maxWidth: 720,
    maxHeight: "85vh",
    overflowY: "auto",
    background: "#0f172a",
    opacity: 1,
    border: "1px solid rgba(245,158,11,0.28)",
    borderRadius: 16,
    boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(245,158,11,0.08)",
    padding: "2rem 2rem 2.25rem",
  },
  analysisClose: {
    position: "absolute", top: "0.85rem", right: "0.85rem",
    width: 32, height: 32,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.06)",
    color: "#cbd5e1",
    border: "1px solid rgba(255,255,255,0.08)",
    fontSize: "1.1rem", lineHeight: 1,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  analysisHeader: {
    paddingBottom: "1rem",
    marginBottom: "1.1rem",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  // Eyebrow on the left, "Powered by Claude" on the right. paddingRight
  // leaves room for the absolute close button (top: 0.85rem, right:
  // 0.85rem, 32px wide) so they don't visually overlap.
  analysisTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    paddingRight: "2.5rem",
    marginBottom: "0.9rem",
  },
  analysisPoweredBy: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    fontSize: 10,
    color: "#fff",
    opacity: 0.5,
    whiteSpace: "nowrap",
  },
  analysisPoweredByLogo: {
    height: 16, width: "auto",
    filter: "brightness(0) invert(1)",
    display: "block",
  },
  analysisVerdictRow: {
    display: "flex", alignItems: "center", gap: "1.2rem",
    marginTop: "0.85rem",
    flexWrap: "wrap",
  },
  verdictPill: {
    fontSize: "0.85rem", fontWeight: 800,
    letterSpacing: "0.12em", textTransform: "uppercase",
    padding: "0.4rem 0.85rem",
    borderRadius: 999,
  },
  verdictFavorable: {
    background: "rgba(16,185,129,0.18)",
    border: "1px solid rgba(16,185,129,0.5)",
    color: "#34d399",
  },
  verdictNeutral: {
    background: "rgba(148,163,184,0.16)",
    border: "1px solid rgba(148,163,184,0.4)",
    color: "#cbd5e1",
  },
  verdictUnfavorable: {
    background: "rgba(248,113,113,0.18)",
    border: "1px solid rgba(248,113,113,0.5)",
    color: "#f87171",
  },
  confidenceWrap: {
    flex: 1, minWidth: 160,
    display: "flex", flexDirection: "column", gap: "0.35rem",
  },
  confidenceLabel: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.14em", textTransform: "uppercase",
    color: "#94a3b8",
  },
  confidenceValue: {
    color: "#fbbf24",
    fontVariantNumeric: "tabular-nums",
  },
  confidenceTrack: {
    height: 4,
    background: "rgba(245,158,11,0.12)",
    borderRadius: 999,
    overflow: "hidden",
  },
  confidenceFill: {
    height: "100%",
    background: "linear-gradient(90deg, rgba(245,158,11,0.7), rgba(251,191,36,1))",
    borderRadius: 999,
    transition: "width 0.4s ease",
  },
  // Bumped contrast + line-height across the analysis body so text
  // reads comfortably at length. Section heads stay tight gold caps;
  // body text is bright slate-200 with 1.65 line-height; summary gets
  // the brightest treatment so it pops as the lede.
  analysisSummary: {
    color: "#f1f5f9",
    fontSize: "1rem", lineHeight: 1.65,
    margin: "0 0 1.5rem",
  },
  analysisSection: {
    paddingBottom: "0.85rem",
    marginBottom: "0.85rem",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  analysisSectionHead: {
    fontSize: "0.72rem", fontWeight: 800,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#f8fafc",
    marginBottom: "0.6rem",
  },
  analysisSectionBody: {
    color: "#e2e8f0",
    fontSize: "0.95rem", lineHeight: 1.65,
    margin: 0,
  },
  analysisReasons: {
    margin: "0.6rem 0 0",
    paddingLeft: "1.25rem",
  },
  analysisReasonItem: {
    color: "#e2e8f0",
    fontSize: "0.95rem", lineHeight: 1.55,
    marginBottom: "0.7rem",
    paddingLeft: "0.25rem",
  },
};
