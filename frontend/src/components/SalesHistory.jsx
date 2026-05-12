import { useEffect, useRef, useState } from "react";

// Renders the recent-comps table for a card. Owns its own state for
// the grade-filter dropdown so the user can browse comps across grades
// (PSA 8, PSA 9, PSA 10, Raw, etc) without each grade switch having to
// bubble up to CardModal.
//
// Initial fetch on mount uses no grade param → backend returns the
// cached raw_comps for the card's own grade plus the availableGrades
// list for the dropdown. Subsequent fetches pass the user-selected
// grade and the backend live-fetches CardHedger comps for that grade.

function fmt(n) {
  return n != null
    ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
}

// PWCC was acquired by Fanatics and now operates as Fanatics Collect.
// CardHedger still tags historical comps with the legacy "PWCC" label;
// remap on display so the badge reads consistently with the live brand.
function displaySource(source) {
  if (!source) return "—";
  if (String(source).toLowerCase() === "pwcc") return "Fanatics Collect";
  return source;
}

// Known marketplaces render their brand logo instead of a text badge —
// the wordmark is recognisable at a glance and saves horizontal space.
// Anything else falls back to the gold-bordered uppercase text pill.
// CardHedger still tags Fanatics Collect rows with the legacy "PWCC"
// label, so both spellings map to the same logo.
function SourceBadge({ source }) {
  const key = source ? String(source).toLowerCase() : "";
  if (key === "ebay") {
    return <img src="/ebay-logo.svg" alt="eBay" style={st.brandLogo} />;
  }
  if (key === "pwcc" || key === "fanatics collect" || key === "fanatics_collect") {
    return <img src="/fanatics-collect-logo.png" alt="Fanatics Collect" style={st.brandLogo} />;
  }
  return <span style={st.source}>{displaySource(source)}</span>;
}

function formatSaleDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

const PAGE_SIZE = 20;

export default function SalesHistory({ card, loadSales }) {
  const [sales, setSales]                       = useState([]);
  const [availableGrades, setAvailableGrades]   = useState([]);
  const [selectedGrade, setSelectedGrade]       = useState(null);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState(false);
  // Render only the first PAGE_SIZE rows initially; clicking "Load more"
  // bumps the visible window. Avoids paying DOM cost on the long-tail
  // 50+ row "All grades" responses while the sidebar is still settling.
  const [visibleCount, setVisibleCount]         = useState(PAGE_SIZE);

  // Reset when the card changes (e.g. modal switches to another card).
  // Without this, state from the previous card leaks across mounts.
  const lastCardId = useRef(null);
  useEffect(() => {
    if (lastCardId.current !== card?.id) {
      lastCardId.current = card?.id;
      setSelectedGrade(null);
      setSales([]);
      setAvailableGrades([]);
    }
  }, [card?.id]);

  // Fetch effect — runs on mount and whenever selectedGrade changes.
  // selectedGrade=null on first run = "use the card's own grade
  // (server resolves it from the row)". Subsequent grade picks pass
  // the chosen label.
  //
  // AbortController on cleanup: rapid card-switching (e.g. clicking
  // through a grid) used to leave stacked in-flight fetches racing
  // each other. The signal aborts the previous request whenever the
  // effect re-runs, so the latest selection always wins and we don't
  // waste bandwidth on responses we'll never render.
  useEffect(() => {
    if (!card?.id) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    loadSales(card.id, selectedGrade, { signal: ctrl.signal })
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setSales(data?.sales ?? []);
        setAvailableGrades(data?.availableGrades ?? []);
        // Reset the windowed-list cursor whenever the dataset changes
        // so a long previous list doesn't bleed into the new selection.
        setVisibleCount(PAGE_SIZE);
        // Server tells us which grade these sales correspond to.
        // Sync selectedGrade if we didn't have one yet (first mount)
        // so the dropdown reflects the resolved default.
        if (selectedGrade == null && data?.currentGrade) {
          setSelectedGrade(data.currentGrade);
        }
      })
      .catch((err) => {
        // AbortError is the expected cleanup path — don't treat it as
        // a real failure. Anything else is a network/server issue.
        if (ctrl.signal.aborted || err?.name === "AbortError") return;
        setError(true); setSales([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [card?.id, selectedGrade, loadSales]);

  return (
    <div style={st.container}>
      {availableGrades.length > 1 && (
        <div style={st.filterRow}>
          <label style={st.filterLabel}>Grade</label>
          <select
            value={selectedGrade ?? ""}
            onChange={(e) => setSelectedGrade(e.target.value)}
            style={st.select}
            disabled={loading}
          >
            {/* "all" sentinel — server fans out parallel comps fetches
                and merges by date desc. Slower than a single-grade
                lookup but no other way to surface cross-grade comps. */}
            <option value="all" style={{ background: "#0f172a", color: "#fff" }}>
              All grades
            </option>
            {availableGrades.map((g) => (
              <option key={g} value={g} style={{ background: "#0f172a", color: "#fff" }}>
                {g}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div style={st.loading}>
          <span style={st.spinner}>●</span>
          <span>Loading sales…</span>
        </div>
      ) : error || sales.length === 0 ? (
        <div style={st.placeholder}>No pricing data available</div>
      ) : (
        <div style={st.list}>
          {sales.slice(0, visibleCount).map((sale, i) => {
            // "All grades" view shows the per-row grade so the user
            // can tell which grade each sale belongs to. Grid template
            // adds a column when active to keep alignment tight.
            const showGrade = selectedGrade === "all";
            const row = (
              <>
                <span style={st.date}>{formatSaleDate(sale.sale_date)}</span>
                {showGrade && (
                  <span style={st.gradePill}>{sale.grade ?? "—"}</span>
                )}
                <SourceBadge source={sale.price_source} />
                {sale.sale_type && (
                  <span style={st.saleTypePill}>{sale.sale_type}</span>
                )}
                <span style={st.price}>{fmt(sale.price)}</span>
              </>
            );
            const rowStyle = {
              ...st.row,
              ...(showGrade ? st.rowWithGrade : {}),
              background: i % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
            };
            return sale.sale_url ? (
              <a
                key={i}
                href={sale.sale_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...rowStyle, ...st.link }}
              >
                {row}
              </a>
            ) : (
              <div key={i} style={rowStyle}>{row}</div>
            );
          })}
          {visibleCount < sales.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              style={st.loadMore}
            >
              Load more ({sales.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const st = {
  container: { display: "flex", flexDirection: "column", gap: "0.55rem" },
  filterRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "0.6rem",
  },
  filterLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b",
  },
  select: {
    flex: "0 1 160px",
    height: 30,
    padding: "0 0.6rem",
    borderRadius: 6,
    background: "rgba(15,23,42,0.85)",
    color: "#f1f5f9",
    border: "1px solid rgba(245,158,11,0.3)",
    fontSize: "0.78rem", fontFamily: "inherit", fontWeight: 700,
    cursor: "pointer",
    outline: "none",
    fontVariantNumeric: "tabular-nums",
  },
  loading: {
    display: "flex", alignItems: "center", gap: "0.55rem",
    color: "#64748b", fontSize: "0.82rem",
    padding: "1rem 0",
  },
  spinner: {
    color: "#f59e0b", fontSize: "0.7rem",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  placeholder: {
    background: "rgba(255,255,255,0.02)",
    border: "1px dashed rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "1.25rem 1rem",
    color: "#64748b",
    fontSize: "0.82rem",
    textAlign: "center", fontStyle: "italic",
    letterSpacing: "0.02em",
  },
  list: {
    maxHeight: 260,
    overflowY: "auto",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.01)",
    // Promote to its own compositor layer so scrolling within the
    // sales list doesn't trigger reflows in the surrounding sidebar.
    willChange: "transform",
  },
  loadMore: {
    width: "100%",
    background: "transparent",
    border: "none",
    borderTop: "1px solid rgba(245,158,11,0.15)",
    color: "#fbbf24",
    fontSize: "0.78rem", fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase",
    padding: "0.7rem 0.95rem",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  row: {
    // Flex with alignItems: center vertically centres every cell —
    // crucial because the SourceBadge can be a 20px-tall logo OR a
    // 16px-tall text pill OR an auto-sized image, and we want them
    // all to share a baseline with the price text. Date takes flex: 1
    // so it consumes the leftover horizontal space and pushes
    // grade-pill / source / price flush right.
    display: "flex",
    alignItems: "center",
    gap: "0.85rem",
    padding: "0.65rem 0.95rem",
    fontSize: "0.82rem",
    borderBottom: "1px solid rgba(245,158,11,0.08)",
    fontVariantNumeric: "tabular-nums",
  },
  // No additional layout hint needed under flex — the gradePill slots
  // in between date and source via DOM order automatically. Kept as an
  // empty entry in case future visual tweaks need a grade-mode hook.
  rowWithGrade: {},
  gradePill: {
    color: "#fbbf24", fontWeight: 800,
    fontSize: "0.62rem",
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.4)",
    padding: "0.1rem 0.4rem", borderRadius: 3,
    letterSpacing: "0.04em",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // Renders the CardHedger sale_type ("Auction", "Best Offer", any
  // future variant). Open-ended — whatever the API returns shows here.
  // Hidden when sale_type is null/missing (see render guard above).
  // Visually quieter than gradePill / SourceBadge so it reads as
  // supporting context, not as a primary dimension.
  saleTypePill: {
    fontSize: "0.66rem", fontWeight: 600,
    color: "#94a3b8",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "0.1rem 0.4rem", borderRadius: 3,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  link: {
    textDecoration: "none",
    color: "inherit",
    cursor: "pointer",
  },
  date: { color: "#cbd5e1", flex: 1, minWidth: 0 },
  source: {
    color: "#94a3b8", fontWeight: 700,
    fontSize: "0.7rem",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(245,158,11,0.3)",
    padding: "0.1rem 0.4rem", borderRadius: 3,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  brandLogo: {
    // Locked to 20px tall (≈ row text line-height) so eBay and Fanatics
    // logos render at the same vertical footprint despite different
    // intrinsic aspect ratios. width: auto preserves each wordmark's
    // proportions. verticalAlign: middle is harmless under flex
    // alignment but keeps the image vertically anchored if the parent
    // ever falls back to inline flow.
    height: 20, width: "auto",
    objectFit: "contain",
    display: "block",
    verticalAlign: "middle",
  },
  price: {
    color: "#f59e0b", fontWeight: 800,
    letterSpacing: "-0.01em",
  },
};
