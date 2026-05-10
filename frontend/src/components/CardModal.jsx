import { useEffect, useMemo, useRef, useState } from "react";
import { fetchUserAttributes } from "aws-amplify/auth";
import {
  getCard as defaultGetCard,
  getCardSales as defaultGetCardSales,
} from "../services/api.js";
import { getRarityTier, TIER_LABELS } from "../utils/rarity.js";
import GhostIcon from "./GhostIcon.jsx";
import CardPop from "./CardPop.jsx";
import SalesHistory from "./SalesHistory.jsx";
import ConsignBlock from "./ConsignBlock.jsx";

const CONSIGNMENT_TYPE_LABEL = { auction: "Auction", private: "Private Sale" };
const CONSIGNMENT_STATUS_LABEL = {
  pending: "Pending",
  in_review: "In Review",
  listed: "Listed",
  sold: "Sold",
  declined: "Declined",
};
const CONSIGNMENT_STATUS_COLOR = {
  pending: "#fbbf24",
  in_review: "#93c5fd",
  listed: "#6ee7b7",
  sold: "#a7f3d0",
  declined: "#fca5a5",
};

function isRare(card) {
  return getRarityTier(card) !== null;
}

function fmt(n) {
  return n != null ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null;
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

// Optional `loaders` lets a parent (e.g. /admin/consignments) swap the
// freshness re-fetch and sales fetch to admin-scoped endpoints that aren't
// gated on user_id ownership. Defaults preserve the user-scoped behaviour
// for the portfolio page's normal use of CardModal.
//
// `adminConsignment` triggers a read-only consignment details block in the
// admin view (type / asking / notes / status / sold price). When set, the
// collector-side ConsignBlock (which is a write-form / status pill) is
// suppressed since admins manage the workflow through the queue page.
export default function CardModal({
  card,
  onClose,
  loaders,
  adminConsignment,
  onCardUpdate,
}) {
  const getCard      = loaders?.getCard      ?? defaultGetCard;
  const getCardSales = loaders?.getCardSales ?? defaultGetCardSales;
  // CardPop is always mounted while the sidebar is open — `pop.open` toggles
  // its visibility via opacity + pointer-events. Keeping it mounted skips the
  // React reconciliation that would otherwise run on every zoom click.
  const [pop, setPop] = useState({ open: false, src: null, alt: null });
  const [visible, setVisible]         = useState(false);
  const [closing, setClosing]         = useState(false);
  // Sales state lives inside SalesHistory now — it owns the grade
  // dropdown + re-fetch logic. CardModal just passes the loader.
  // Animation completes at ~320ms — mount the heavy below-the-fold content
  // (sales chart) only after that to keep the slide-in compositor frames clean.
  const [hydrated, setHydrated] = useState(false);
  // Fetch role lazily so the Consign button shows for collectors only and is
  // hidden for admins. Defer past the slide-in so the network call doesn't
  // compete with the compositor.
  const [role, setRole] = useState(null);
  // Memoize derived values that only depend on `card`. getRarityTier
  // walks several fields and the rest are conditional chains; cheap
  // individually but they used to recompute on every render (modal
  // re-renders frequently — pop toggles, role fetch, hydration flag,
  // image load). Caching against the card identity keeps them flat.
  const tier = useMemo(() => getRarityTier(card), [card]);
  const rare = tier !== null;

  // Slide-in on mount: paint at translateX(100%), then flip to 0 on next frame
  // so the CSS transition has a from/to to interpolate.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Lock body scroll while sidebar is open. Defer one frame so the synchronous
  // overflow-toggle reflow doesn't compete with the slide-in's first paint —
  // the slide-in begins from translateX(100%) (off-screen) so a one-frame
  // delay on the scroll lock is invisible.
  useEffect(() => {
    let cancelled = false;
    let prev;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      if (prev !== undefined) document.body.style.overflow = prev;
    };
  }, []);

  // Hydrate the heavy content (sales fetch + grade dropdown's
  // all-prices-by-card lookup) after the slide-in settles. Animation
  // duration is 320ms; +30ms slack puts us at 350ms — past any
  // residual GPU compositing work.
  useEffect(() => {
    const id = setTimeout(() => setHydrated(true), 350);
    return () => clearTimeout(id);
  }, []);

  // Fetch role once after hydration. Cached by Amplify in-memory after the
  // first call so subsequent sidebar opens are free.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    fetchUserAttributes()
      .then((attrs) => {
        if (!cancelled) setRole(attrs["custom:role"] ?? null);
      })
      .catch((err) => {
        console.error("CardModal fetchUserAttributes failed:", err);
        if (!cancelled) setRole(null);
      });
    return () => { cancelled = true; };
  }, [hydrated]);

  function handleClose() {
    if (closing) return;
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 320);
  }

  // Escape closes the sidebar (skip when the zoom pop is open — its own
  // Escape handler closes the pop instead)
  useEffect(() => {
    if (pop.open) return;
    function onKey(e) { if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop.open]);

  // (Sales fetch lives inside SalesHistory now — see component below.)

  // Sold cards display their realized soldPrice as the headline value;
  // everything else falls back to the existing manual/auto chain.
  // Memoized as one block so neither value recomputes when state
  // unrelated to `card` changes (pop toggle, hydration, role fetch).
  const { sold, displayValue } = useMemo(() => {
    const isSoldCard =
      card.consignmentStatus === "sold" && card.consignmentSoldPrice != null;
    return {
      sold: isSoldCard,
      displayValue: isSoldCard
        ? card.consignmentSoldPrice
        : (card.estimatedValue ?? card.avgSalePrice),
    };
  }, [card]);

  return (
    <>
      <div
        style={{ ...st.backdrop, opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />
      <aside
        style={{
          ...st.sidebar,
          ...(tier ? sidebarTierStyle(tier) : {}),
          transform: visible ? "translateX(0)" : "translateX(100%)",
        }}
        role="dialog"
        aria-label="Card details"
      >
        <button style={st.closeBtn} onClick={handleClose} aria-label="Close">✕</button>

        <div style={st.scroll}>
          {/* ── Card image ── */}
          <CardImage
            card={card}
            getCard={getCard}
            onZoom={(args) => setPop({ open: true, ...args })}
          />

          {/* ── Player + subtitle ── */}
          <h2 style={st.playerName}>{card.playerName ?? "Unknown Player"}</h2>
          <p style={st.subLine}>
            {[card.year, card.brand, card.sport].filter(Boolean).join(" · ") || "—"}
          </p>

          {/* ── Grade + tier badges ── */}
          <div style={st.gradeRow}>
            <div style={{ ...st.gradeBadge, ...(tier ? gradeBadgeTierStyle(tier) : {}) }}>
              {(card.grader ?? "PSA") === "PSA"
                ? <img src="/psa.avif" alt="PSA" style={st.gradeBadgeLogo} />
                : <span style={st.gradeBadgeText}>{card.grader}</span>}
              <span style={st.gradeBadgeNum}>{card.grade}</span>
              {card.gradeDescription && (
                <span style={st.gradeDesc}>{card.gradeDescription}</span>
              )}
            </div>
            {tier && <TierBanner tier={tier} card={card} />}
          </div>

          {/* ── Card details ── */}
          <table style={st.table}>
            <tbody>
              {[
                ["Card #",  card.cardNumber],
                ["Cert #",  card.certNumber],
                ["Variety", card.variety],
              ].map(([label, val]) =>
                val ? (
                  <tr key={label}>
                    <td style={st.tdLabel}>{label}</td>
                    <td style={st.tdVal}>{val}</td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>

          {/* ── Population ──
              Loose `!= null` (not strict `!== null`) so undefined behaves
              the same as null — important when CardModal is opened with a
              partial card stub (e.g. from /admin/consignments where the
              row carries only id/name/year/brand/grade/cert/value). With
              strict !==, `undefined !== null` → true, then we'd call
              `.toLocaleString()` on undefined and unmount the whole page. */}
          {(card.psaPopulation != null || card.psaPopulationHigher != null) && (
            <>
              <div style={st.sectionHead}>PSA Population</div>
              <div style={{ ...st.popBlock, ...(rare ? st.popBlockRare : {}) }}>
                {card.psaPopulation != null && (
                  <PopStat
                    label="At grade"
                    value={card.psaPopulation.toLocaleString()}
                    highlight={rare}
                  />
                )}
                {card.psaPopulationHigher != null && (
                  <PopStat
                    label="Graded higher"
                    value={card.psaPopulationHigher.toLocaleString()}
                    highlight={card.psaPopulationHigher === 0}
                    highlightColor="#10b981"
                  />
                )}
              </div>
            </>
          )}

          {/* ── Market Value (held cards only) ──
              Sold cards skip this block entirely — the sale price is shown
              in ConsignBlock below as part of the consignment status, and
              market estimates are irrelevant once the card has exited. */}
          {!sold && displayValue != null && (
            <>
              <div style={st.sectionHead}>Market Value</div>
              <div style={st.priceBlock}>
                <div style={st.mainPrice}>
                  {fmt(displayValue)}
                </div>
                <div style={st.priceDetails}>
                  {card.avgSalePrice  && <span>Avg {fmt(card.avgSalePrice)}</span>}
                  {card.lastSalePrice && <><span style={st.dot}>·</span><span>Last {fmt(card.lastSalePrice)}</span></>}
                  {card.numSales      && <><span style={st.dot}>·</span><span>{card.numSales} sales</span></>}
                </div>
                {card.priceSource && (
                  <span style={{ ...st.sourceBadge, ...sourceBadgeStyle(card.priceSource) }}>
                    {badgeLabel(card.priceSource)}
                  </span>
                )}
              </div>
            </>
          )}

          {/* ── Sold cards: surface consignment status (with sold price)
                immediately, followed by realized P&L. Held cards keep the
                existing bottom-of-sidebar placement so the consign CTA
                sits below the market context. */}
          {sold && hydrated && !adminConsignment && (
            <ConsignBlock
              cardId={card.id}
              role={role}
              consignmentStatus={card.consignmentStatus ?? null}
              consignmentSoldPrice={card.consignmentSoldPrice ?? null}
              consignmentBlocked={card.consignmentBlocked ?? false}
              onConsigned={(status) => onCardUpdate?.(card.id, { consignmentStatus: status })}
            />
          )}

          {/* ── Cost + P&L (realized for sold, unrealized for held) ── */}
          <CostAndPnl card={card} displayValue={displayValue} />

          {/* ── Target price (only meaningful while held) ── */}
          {!sold && card.targetPrice != null && (
            <>
              <div style={st.sectionHead}>Target Price</div>
              <div style={st.targetBlock}>
                <span style={st.targetValue}>{fmt(card.targetPrice)}</span>
                {card.targetReached && (
                  <span style={st.targetReachedTag}>
                    <span style={st.targetReachedDot} /> Target Hit
                  </span>
                )}
              </div>
            </>
          )}

          {/* ── Sales history ── */}
          {/* Render an inert placeholder during the slide-in so the chart's
              SVG layout doesn't fight for main-thread time during the
              animation. After hydration the full SalesHistory takes over. */}
          <div style={st.sectionHead}>Sales History</div>
          {hydrated
            ? <SalesHistory card={card} loadSales={getCardSales} />
            : <div style={st.salesPlaceholder} />}

          {/* ── Consign this card (held cards only) ──
              Sold cards already rendered ConsignBlock at the top — repeating
              it here would duplicate the status pill. Suppressed when
              adminConsignment is provided so admins see the read-only
              AdminConsignmentBlock instead. */}
          {!sold && hydrated && !adminConsignment && (
            <ConsignBlock
              cardId={card.id}
              role={role}
              consignmentStatus={card.consignmentStatus ?? null}
              consignmentSoldPrice={card.consignmentSoldPrice ?? null}
              consignmentBlocked={card.consignmentBlocked ?? false}
              onConsigned={(status) => onCardUpdate?.(card.id, { consignmentStatus: status })}
            />
          )}

          {/* ── Admin consignment details ──
              Read-only summary of the consignment row the admin clicked.
              Does NOT duplicate the inline editing in /admin/consignments;
              this is for context while reviewing the card itself. */}
          {adminConsignment && (
            <AdminConsignmentBlock consignment={adminConsignment} />
          )}
        </div>
      </aside>

      {/* Always mounted; toggled via pop.open. Avoids mount/unmount cost
          and pre-warms the layout/style for instant subsequent opens. */}
      <CardPop
        open={pop.open}
        src={pop.src}
        alt={pop.alt}
        onClose={() => setPop((p) => ({ ...p, open: false }))}
      />
    </>
  );
}

// ─── Card image (5:7 framed, click-to-zoom) ──────────────────────────
// Refreshes the URL via getCard on mount — the freshly-signed S3 URL
// avoids any CORS-cache issues from the portfolio grid fetch. Deferred
// past the slide-in animation so the network request + re-render don't
// compete with the compositor for main-thread time.
function CardImage({ card, onZoom, getCard }) {
  const [imgUrl, setImgUrl] = useState(card.imageUrl ?? null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      getCard(card.id)
        .then((fresh) => {
          if (!cancelled && fresh.imageUrl) setImgUrl(fresh.imageUrl);
        })
        .catch(() => {});
    }, 340);
    return () => { cancelled = true; clearTimeout(id); };
  }, [card.id]);

  function handleClick() {
    if (!imgUrl) return;
    onZoom({ src: imgUrl, alt: card.playerName ?? "Card" });
  }

  return (
    <div style={st.imageOuter}>
      <div
        style={{ ...st.imageFrame, cursor: imgUrl ? "pointer" : "default" }}
        onClick={handleClick}
        title={imgUrl ? "Click to zoom" : undefined}
      >
        {imgUrl && !errored ? (
          <img
            src={imgUrl}
            alt={card.playerName ?? "Card"}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            draggable={false}
            style={st.cardImage}
          />
        ) : (
          <div style={st.imageFallback}>
            <span style={{ fontSize: "2rem", opacity: 0.4 }}>🃏</span>
            <span style={{ fontSize: "0.7rem", color: "#475569", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {errored ? "Image unavailable" : "No image"}
            </span>
          </div>
        )}
        {!loaded && imgUrl && !errored && (
          <div style={st.imageLoading}>
            <span style={{ color: "#475569", fontSize: "1.2rem", animation: "pulse 1.2s ease-in-out infinite" }}>●</span>
          </div>
        )}
      </div>
    </div>
  );
}

function sidebarTierStyle(tier) {
  if (tier === "ghost") {
    return {
      borderLeft: "1px solid rgba(226,232,240,0.55)",
      boxShadow: "-12px 0 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(226,232,240,0.18), 0 0 80px rgba(226,232,240,0.12)",
    };
  }
  if (tier === "ultra_rare") {
    return {
      borderLeft: "1px solid rgba(245,158,11,0.55)",
      boxShadow: "-12px 0 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.2), 0 0 80px rgba(245,158,11,0.1)",
    };
  }
  return {
    borderLeft: "1px solid rgba(147,197,253,0.45)",
    boxShadow: "-12px 0 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(147,197,253,0.2)",
  };
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

// ─── Tiered rarity banner shown beneath the 3D viewport ───
function TierBanner({ tier, card }) {
  const variant =
    tier === "ghost"      ? st.tierBannerGhost
    : tier === "ultra_rare" ? st.tierBannerUltraRare
    : st.tierBannerRare;
  const sub = tier === "ghost"
    ? `Pop ${card.psaPopulation} · None Higher`
    : tier === "ultra_rare"
    ? `Pop ${card.psaPopulation} · None Higher`
    : `Pop ${card.psaPopulation} · None Higher`;
  return (
    <div style={{ ...st.tierBannerBase, ...variant }}>
      {tier === "ghost"
        ? <span style={st.tierBannerGhostIcon}><GhostIcon size={28} /></span>
        : <span style={st.tierBannerMark}>✦</span>}
      <span style={st.tierBannerLabel}>{TIER_LABELS[tier]}</span>
      <span style={st.tierBannerDot}>·</span>
      <span style={st.tierBannerSub}>{sub}</span>
    </div>
  );
}

function modalTierStyle(tier) {
  if (tier === "ghost")
    return { boxShadow: "0 24px 60px rgba(0,0,0,0.35), 0 0 0 2px rgba(226,232,240,0.85), 0 0 60px rgba(226,232,240,0.25)" };
  if (tier === "ultra_rare")
    return { boxShadow: "0 24px 60px rgba(0,0,0,0.35), 0 0 0 2px #f59e0b" };
  return { boxShadow: "0 24px 60px rgba(0,0,0,0.35), 0 0 0 2px rgba(147,197,253,0.85)" };
}

function gradeBadgeTierStyle(tier) {
  if (tier === "ghost") {
    return {
      background: "linear-gradient(135deg, #f8fafc, #cbd5e1)",
      color: "#0f172a",
      boxShadow: "0 0 16px rgba(255,255,255,0.45)",
    };
  }
  if (tier === "ultra_rare") {
    return {
      background: "linear-gradient(135deg, #fef3c7, #fde68a)",
      boxShadow: "0 2px 8px rgba(217,119,6,0.25)",
    };
  }
  return {
    background: "linear-gradient(135deg, #dbeafe, #bfdbfe)",
    color: "#1e3a8a",
    boxShadow: "0 0 12px rgba(147,197,253,0.4)",
  };
}

function PopStat({ label, value, highlight, highlightColor = "#d97706" }) {
  return (
    <div style={st.popStat}>
      <span style={st.popStatLabel}>{label}</span>
      <span style={{ ...st.popStatValue, ...(highlight ? { color: highlightColor, fontWeight: 700 } : {}) }}>
        {value}
      </span>
    </div>
  );
}

// Admin-only consignment summary inside CardModal. Pure read-only —
// the actual editable controls live in /admin/consignments.
function AdminConsignmentBlock({ consignment }) {
  const status = consignment.status;
  const statusLabel = CONSIGNMENT_STATUS_LABEL[status] ?? status;
  const statusColor = CONSIGNMENT_STATUS_COLOR[status] ?? "#cbd5e1";

  return (
    <>
      <div style={st.sectionHead}>Consignment</div>
      <div style={st.adminConsignBlock}>
        <div style={st.adminConsignRow}>
          <span style={st.adminConsignLabel}>Status</span>
          <span style={{ ...st.adminConsignValue, color: statusColor, fontWeight: 800 }}>
            {statusLabel}
          </span>
        </div>
        <div style={st.adminConsignRow}>
          <span style={st.adminConsignLabel}>Type</span>
          <span style={st.adminConsignValue}>
            {CONSIGNMENT_TYPE_LABEL[consignment.type] ?? consignment.type}
          </span>
        </div>
        {consignment.askingPrice != null && (
          <div style={st.adminConsignRow}>
            <span style={st.adminConsignLabel}>Asking</span>
            <span style={st.adminConsignValue}>{fmt(consignment.askingPrice)}</span>
          </div>
        )}
        {status === "sold" && consignment.soldPrice != null && (
          <div style={st.adminConsignRow}>
            <span style={st.adminConsignLabel}>Sold For</span>
            <span style={{ ...st.adminConsignValue, ...st.adminConsignSold }}>
              {fmt(consignment.soldPrice)}
            </span>
          </div>
        )}
        {consignment.notes && (
          <div style={st.adminConsignNotesBlock}>
            <div style={st.adminConsignLabel}>Collector Notes</div>
            <div style={st.adminConsignNotes}>{consignment.notes}</div>
          </div>
        )}
        {consignment.internalNotes && (
          <div style={st.adminConsignNotesBlock}>
            <div style={st.adminConsignLabel}>Internal Notes</div>
            <div style={st.adminConsignNotesInternal}>{consignment.internalNotes}</div>
          </div>
        )}
      </div>
    </>
  );
}

function CostAndPnl({ card, displayValue }) {
  if (card.myCost == null) return null;
  // P&L derivation memoized so it doesn't recompute on every parent
  // re-render (pop toggle, role fetch, image load). Cheap individually
  // but multiplied across 8-10 renders per modal-open.
  const { sold, hasValue, pnl, positive, pnlPct, pnlLabel } = useMemo(() => {
    const isSold   = card.consignmentStatus === "sold" && card.consignmentSoldPrice != null;
    const has      = displayValue != null;
    const value    = has ? displayValue - card.myCost : null;
    const isPos    = value != null && value >= 0;
    const pct      = has && card.myCost > 0 ? (value / card.myCost) * 100 : null;
    // Label semantics: "profit/loss" reads as settled (sold cards);
    // "gain/loss" reads as unrealized paper movement.
    const label    = isSold
      ? (isPos ? "realized profit" : "realized loss")
      : (isPos ? "unrealized gain" : "unrealized loss");
    return {
      sold:     isSold,
      hasValue: has,
      pnl:      value,
      positive: isPos,
      pnlPct:   pct,
      pnlLabel: label,
    };
  }, [card, displayValue]);

  return (
    <>
      <div style={st.sectionHead}>Your Cost</div>
      <div style={st.costBlock}>
        <div style={st.costRow}>
          <div style={st.costMain}>{fmt(card.myCost)}</div>
        </div>
        {pnl != null && (
          <div style={{ ...st.pnlRow, color: positive ? "#059669" : "#dc2626" }}>
            <span style={st.pnlAmount}>
              {positive ? "+" : "−"}{fmt(Math.abs(pnl))}
            </span>
            {pnlPct != null && (
              <span style={st.pnlPct}>
                ({positive ? "+" : "−"}{Math.abs(pnlPct).toFixed(1)}%)
              </span>
            )}
            <span style={st.pnlLabel}>{pnlLabel}</span>
          </div>
        )}
      </div>
    </>
  );
}

function badgeLabel(s) { return s === "manual" ? "manual" : s === "ebay" ? "eBay" : "est."; }
function sourceBadgeStyle(s) {
  if (s === "manual") return { background: "#ede9fe", color: "#5b21b6" };
  if (s === "ebay")   return { background: "#fef3c7", color: "#92400e" };
  return { background: "#f3f4f6", color: "#9ca3af" };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const st = {
  // ─── Backdrop + sidebar shell ───
  // backdrop-filter intentionally NOT used here — full-screen blur is one of
  // the most expensive composite effects, and combined with an opacity
  // transition it forces the browser to re-rasterize a blurred snapshot of
  // the underlying page on every animation frame. Cost scales with viewport
  // area, which is why the sidebar felt fine on mobile (~330k px) but choppy
  // on desktop (~2M px). Higher backdrop opacity (0.78 vs 0.65) keeps enough
  // visual separation without the blur. Same lesson is in CardPop.jsx.
  backdrop: {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(5,8,17,0.78)",
    transition: "opacity 0.32s ease",
    willChange: "opacity",
  },
  sidebar: {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: 420, maxWidth: "100%",
    zIndex: 1001,
    background: "linear-gradient(180deg, #0f172a 0%, #0a0f1f 100%)",
    borderLeft: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "-12px 0 40px rgba(0,0,0,0.6)",
    transition: "transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
    // willChange tells the browser to promote the sidebar to its own
    // compositor layer ahead of time, so the first frame of the transition
    // doesn't trigger a fresh paint. `contain: layout paint style` isolates
    // the sidebar's paint from the rest of the page — repaints inside the
    // sidebar (sales chart hydrating, image loading) won't invalidate the
    // portfolio underneath.
    willChange: "transform",
    contain: "layout paint style",
    color: "#e2e8f0",
    display: "flex", flexDirection: "column",
  },
  scroll: {
    height: "100%",
    overflowY: "auto",
    padding: "3.25rem 1.75rem 2rem",
  },

  // ─── Tiered rarity banner ───
  // Padding tuned to give the same outer pill height as the PSA grade badge,
  // so the two sit beside each other as a matched pair (both ~36–38px tall
  // with their inner elements at ~32px).
  tierBannerBase: {
    display: "inline-flex", alignItems: "center", gap: "0.5rem",
    fontSize: "0.7rem", fontWeight: 800,
    letterSpacing: "0.1em", textTransform: "uppercase",
    padding: "3px 0.85rem 3px 0.3rem",
    borderRadius: 999,
  },
  tierBannerUltraRare: {
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#0f172a",
    boxShadow: "0 2px 12px rgba(217,119,6,0.45)",
  },
  tierBannerRare: {
    background: "linear-gradient(135deg, rgba(147,197,253,0.18), rgba(99,102,241,0.12))",
    color: "#1e3a8a",
    border: "1px solid rgba(147,197,253,0.7)",
    boxShadow: "0 0 12px rgba(147,197,253,0.3)",
  },
  // Pill stays static; the GhostIcon inside carries the float/sway animation.
  // Padding inherits from tierBannerBase so all tier pills (and the PSA
  // grade badge) line up at the same height.
  tierBannerGhost: {
    background: "linear-gradient(135deg, rgba(248,250,252,0.92), rgba(203,213,225,0.85))",
    color: "#0f172a",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 0 22px rgba(255,255,255,0.55), 0 0 4px rgba(255,255,255,0.9)",
  },
  tierBannerGhostIcon: {
    display: "inline-flex", alignItems: "center",
    marginRight: "0.15rem",
  },
  tierBannerMark: { fontSize: "0.85rem" },
  tierBannerLabel: {},
  tierBannerDot: { opacity: 0.5 },
  tierBannerSub: { fontWeight: 600, letterSpacing: "0.04em", opacity: 0.85 },
  closeBtn: {
    position: "absolute", top: 14, right: 14, zIndex: 5,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "50%",
    width: 32, height: 32, fontSize: "0.85rem",
    cursor: "pointer", color: "#94a3b8",
    display: "flex", alignItems: "center", justifyContent: "center",
  },

  // ─── Sidebar content sections ───
  // Card image: 5:7 framed container (matches a real trading card's aspect
  // ratio); the <img> inside uses max-width/max-height so it never upscales
  // past its natural resolution. object-fit: contain protects against
  // stretching if the source image happens to have a different aspect.
  imageOuter: {
    display: "flex", justifyContent: "center",
    marginBottom: "1.5rem",
  },
  imageFrame: {
    position: "relative",
    width: "100%", maxWidth: 320,
    aspectRatio: "5 / 7",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 12,
    overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  cardImage: {
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto",
    height: "auto",
    objectFit: "contain",
    display: "block",
  },
  imageFallback: {
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: "0.5rem",
  },
  imageLoading: {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    pointerEvents: "none",
  },
  gradeRow: {
    display: "flex", alignItems: "center",
    gap: "0.6rem", flexWrap: "wrap",
    marginTop: "1rem", marginBottom: "1.5rem",
  },

  // Matches tierBannerBase padding so PSA badge + tier banner are identical
  // height when shown as a pair in the gradeRow.
  gradeBadge: {
    display: "inline-flex", alignItems: "center", gap: "0.5rem",
    background: "#fef3c7", color: "#92400e",
    fontWeight: 700, fontSize: "0.85rem",
    padding: "3px 0.85rem 3px 0.3rem",
    borderRadius: 999,
  },
  // 28px image + 2px padding top/bot = 32px total — same height as the
  // GhostIcon when rendered at size 28 (~31.5px tall). Both inner elements
  // line up at ~32px.
  gradeBadgeLogo: {
    height: 28, width: "auto",
    display: "block",
    background: "#fff",
    padding: "2px 5px",
    borderRadius: 4,
  },
  // BGS / SGC text fallback — same height envelope as the PSA logo
  // chip so the badge layout doesn't shift between graders.
  gradeBadgeText: {
    height: 28,
    display: "flex", alignItems: "center",
    background: "#fff",
    color: "#0f172a",
    padding: "0 7px",
    borderRadius: 4,
    fontSize: "0.78rem", fontWeight: 900,
    letterSpacing: "0.04em",
    fontFamily: "inherit",
  },
  gradeBadgeNum: {
    fontSize: "1.05rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  gradeDesc: {
    fontWeight: 500, fontSize: "0.7rem",
    opacity: 0.7, marginLeft: "0.15rem",
    letterSpacing: "0.02em",
  },

  playerName: {
    fontSize: "1.4rem", fontWeight: 800,
    margin: 0, lineHeight: 1.2,
    color: "#f1f5f9",
    letterSpacing: "-0.02em",
  },
  subLine: {
    color: "#94a3b8", fontSize: "0.85rem",
    marginTop: "0.35rem", letterSpacing: "0.02em",
  },
  table: { width: "100%", borderCollapse: "collapse", marginBottom: "1.5rem" },
  tdLabel: {
    color: "#64748b", fontSize: "0.62rem", fontWeight: 700,
    padding: "0.4rem 0.75rem 0.4rem 0",
    width: 90, verticalAlign: "top",
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  tdVal: {
    fontSize: "0.88rem", color: "#e2e8f0",
    padding: "0.4rem 0", fontWeight: 500,
  },
  sectionHead: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#64748b",
    marginBottom: "0.65rem", marginTop: "1.25rem",
  },
  popBlock: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: "0.9rem 1rem", marginBottom: "0.5rem",
    display: "flex", gap: "1.75rem",
  },
  popBlockRare: {
    background: "rgba(245,158,11,0.06)",
    border: "1px solid rgba(245,158,11,0.25)",
  },
  popStat: { display: "flex", flexDirection: "column", gap: "0.2rem" },
  popStatLabel: {
    fontSize: "0.62rem", color: "#64748b",
    letterSpacing: "0.14em", textTransform: "uppercase",
    fontWeight: 600,
  },
  popStatValue: {
    fontSize: "1.15rem", fontWeight: 800, color: "#f1f5f9",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  priceBlock: { marginBottom: "0.75rem" },
  mainPrice: {
    fontSize: "1.85rem", fontWeight: 800,
    color: "#f59e0b", lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    textShadow: "0 0 32px rgba(245,158,11,0.18)",
  },
  // Realized exit — green instead of gold, shadow tinted to match.
  mainPriceSold: {
    color: "#10b981",
    textShadow: "0 0 32px rgba(16,185,129,0.22)",
  },
  priceDetails: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.3rem",
    fontSize: "0.78rem", color: "#94a3b8", marginTop: "0.4rem",
  },
  dot: { color: "#475569" },
  sourceBadge: {
    display: "inline-block", marginTop: "0.55rem",
    fontSize: "0.6rem", fontWeight: 700,
    padding: "0.18rem 0.5rem", borderRadius: 3,
    textTransform: "uppercase", letterSpacing: "0.08em",
  },

  // ── Cost / P&L block ──
  costBlock: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: "0.95rem 1.1rem",
  },
  costRow: { display: "flex", alignItems: "baseline" },
  costMain: {
    fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9",
    fontVariantNumeric: "tabular-nums", lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  pnlRow: {
    display: "flex", alignItems: "center", gap: "0.4rem",
    marginTop: "0.6rem",
    fontVariantNumeric: "tabular-nums",
  },
  pnlAmount: { fontSize: "1rem", fontWeight: 800 },
  pnlPct:    { fontSize: "0.85rem", fontWeight: 700, opacity: 0.85 },
  pnlLabel: {
    marginLeft: "auto",
    fontSize: "0.6rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
    opacity: 0.85,
  },

  // ── Target price block ──
  targetBlock: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "rgba(245,158,11,0.06)",
    border: "1px solid rgba(245,158,11,0.25)",
    borderRadius: 10,
    padding: "0.95rem 1.1rem",
  },
  targetValue: {
    fontSize: "1.4rem", fontWeight: 800, color: "#fbbf24",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
  },
  targetReachedTag: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
    fontSize: "0.6rem", fontWeight: 800,
    color: "#fbbf24", letterSpacing: "0.16em",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(245,158,11,0.55)",
    padding: "0.25rem 0.55rem", borderRadius: 999,
  },
  targetReachedDot: {
    width: 6, height: 6, borderRadius: "50%",
    background: "#f59e0b",
    animation: "livePulse 1.6s ease-in-out infinite",
  },

  // Reserved space for the sales chart pre-hydration so the sidebar's
  // scroll height doesn't snap when SalesHistory swaps in.
  salesPlaceholder: {
    height: 180,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.04)",
    borderRadius: 10,
  },

  // ── Admin-only consignment summary block ──
  adminConsignBlock: {
    background: "rgba(167,139,250,0.06)",
    border: "1px solid rgba(167,139,250,0.28)",
    borderRadius: 10,
    padding: "0.95rem 1.1rem",
    display: "flex", flexDirection: "column", gap: "0.55rem",
  },
  adminConsignRow: {
    display: "flex", alignItems: "baseline",
    justifyContent: "space-between", gap: "0.75rem",
  },
  adminConsignLabel: {
    color: "#94a3b8",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  adminConsignValue: {
    color: "#e2e8f0",
    fontSize: "0.92rem", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  adminConsignSold: {
    color: "#fbbf24",
  },
  adminConsignNotesBlock: {
    paddingTop: "0.4rem",
    borderTop: "1px solid rgba(167,139,250,0.18)",
    display: "flex", flexDirection: "column", gap: "0.3rem",
  },
  adminConsignNotes: {
    color: "#cbd5e1",
    fontSize: "0.85rem",
    lineHeight: 1.5,
    fontStyle: "italic",
  },
  adminConsignNotesInternal: {
    color: "#c4b5fd",
    fontSize: "0.85rem",
    lineHeight: 1.5,
    background: "rgba(167,139,250,0.08)",
    border: "1px solid rgba(167,139,250,0.22)",
    borderRadius: 6,
    padding: "0.5rem 0.65rem",
  },
};
