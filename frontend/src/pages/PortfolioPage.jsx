import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  getCards, deleteCard, getPortfolioValue, getPortfolioHistory, refreshPortfolio,
  updateCardPrice, updateCard,
} from "../services/api.js";
import CardModal from "../components/CardModal.jsx";
import GhostIcon from "../components/GhostIcon.jsx";
import { getRarityTier, TIER_LABELS, TIER_COLORS } from "../utils/rarity.js";
import { gradients } from "../utils/theme.js";
import {
  isSold, isTraded, effectiveValue, cardPnl, summarizePortfolio,
} from "../utils/portfolio.js";

// Slice palette — gold-dominant with cool/jewel accents for variety.
// Order matters: top categories get the gold tones first.
const PALETTE = [
  "#f59e0b", // gold
  "#06b6d4", // cyan
  "#fbbf24", // light gold
  "#a78bfa", // purple
  "#10b981", // emerald
  "#f43f5e", // rose
  "#d97706", // dark gold
  "#94a3b8", // slate (overflow)
];

// ─── Helpers ────────────────────────────────────────────────────────────
const fmtUsd = (n, opts = {}) =>
  n != null
    ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts })}`
    : "—";

// Truthy when a card belongs to any rarity tier — used by hero count, filter chip, etc.
function isRare(card) {
  return getRarityTier(card) !== null;
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function PortfolioPage() {
  const [cards, setCards]               = useState([]);
  const [totalValue, setTotalValue]     = useState(null);
  const [tradesExecuted, setTradesExecuted] = useState(0);
  const [history, setHistory]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [editingCard, setEditingCard]   = useState(null);
  // Transient gold-pulse highlight for cards just received in a trade.
  // Set in onTradeComplete and auto-cleared after 3s. Kept out of the URL
  // because it's a one-shot post-action effect, not a deep-link state.
  const [pulseIds, setPulseIds]         = useState(null);


  // Stale-while-revalidate. Phase 1: fast DB read of cards + value + history,
  // render the page immediately. Phase 2: kick off /portfolio/refresh in the
  // background; if any cards came back fresh, re-fetch the fast endpoints
  // and silently swap state. Server-side refresh is rate-limited by the 24h
  // staleness gate, so calling it on every mount is cheap.
  useEffect(() => {
    let cancelled = false;

    async function silentlyApplyValue() {
      try {
        const [cardList, valueData] = await Promise.all([getCards(), getPortfolioValue()]);
        if (cancelled) return;
        const pricingById = Object.fromEntries(valueData.cards.map((c) => [c.id, c]));
        const merged = cardList.map((card) => ({ ...card, ...pricingById[card.id] }));
        setCards(merged);
        setTotalValue(valueData.totalValue);
        setTradesExecuted(valueData.tradesExecuted ?? 0);
      } catch {
        // Swallow — refresh-driven re-fetch shouldn't surface as an error
        // when the initial render already succeeded.
      }
    }

    Promise.all([getCards(), getPortfolioValue(), getPortfolioHistory()])
      .then(([cardList, valueData, historyData]) => {
        if (cancelled) return;
        const pricingById = Object.fromEntries(valueData.cards.map((c) => [c.id, c]));
        const merged = cardList.map((card) => ({ ...card, ...pricingById[card.id] }));
        setCards(merged);
        setTotalValue(valueData.totalValue);
        setTradesExecuted(valueData.tradesExecuted ?? 0);
        setHistory(historyData);
        setLoading(false);

        // Phase 2 — fire-and-forget. If the server actually refreshed any
        // rows, pull the new values without blocking anything user-visible.
        refreshPortfolio()
          .then((res) => {
            if (cancelled || !res?.refreshed) return;
            silentlyApplyValue();
          })
          .catch(() => { /* background refresh failures are non-fatal */ });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // useCallback so the reference is stable across renders — prevents
  // `React.memo(CardTile)` from busting on every parent state change. All
  // setters used inside are themselves stable, so the empty-deps array
  // is safe.
  const handleDelete = useCallback(async (id) => {
    if (!window.confirm("Remove this card from your portfolio?")) return;
    await deleteCard(id);
    setCards((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const newTotal = next.reduce((sum, c) => sum + (c.estimatedValue ?? 0), 0);
      setTotalValue(Math.round(newTotal * 100) / 100);
      return next;
    });
  }, []);

  const handleCardUpdate = useCallback((id, patch) => {
    setSelectedCard((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
    setCards((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      // Use effectiveValue so sold cards count their realized soldPrice
      // instead of the (now-irrelevant) estimatedValue.
      const newTotal = next.reduce((sum, c) => sum + (effectiveValue(c) ?? 0), 0);
      setTotalValue(Math.round(newTotal * 100) / 100);
      return next;
    });
  }, []);

  // Stable click handlers passed through to CardTile. They take `card`
  // as a parameter (CardTile invokes them with its own card prop) so
  // the reference stays identity-equal across renders — no per-row
  // closure churn that would defeat React.memo.
  const openCardModal = useCallback((c) => setSelectedCard(c), []);
  const startEdit     = useCallback((c) => setEditingCard(c), []);

  const cardCount  = cards.length;
  const rareCount  = useMemo(() => cards.filter(isRare).length, [cards]);
  const ghostCount = useMemo(
    () => cards.filter((c) => getRarityTier(c) === "ghost").length,
    [cards]
  );

  // Realized vs unrealized split — sold cards (with admin-entered sold_price)
  // contribute to realized; everything else contributes to unrealized. The
  // helper handles missing cost/value gracefully.
  const summary = useMemo(() => summarizePortfolio(cards), [cards]);
  const totalInvested = summary.totalInvested;
  const hasCost       = totalInvested > 0;
  const pnl           = hasCost ? summary.totalPnl : null;
  const pnlPct        = hasCost && pnl != null ? (pnl / totalInvested) * 100 : null;
  const realizedPnl   = summary.hasSoldCost ? summary.realizedPnl   : null;
  const unrealizedPnl = summary.hasHeldCost ? summary.unrealizedPnl : null;
  // Display total uses effectiveValue per card (soldPrice for sold, else
  // estimatedValue) — the API's getPortfolioValue total only sums cards
  // table estimatedValue and would miss sold cards' realized exit price.
  const displayTotalValue = cards.length > 0 ? summary.totalValue : totalValue;
  const avgValue          = cardCount > 0 && displayTotalValue ? displayTotalValue / cardCount : null;
  const alerts        = useMemo(() => cards.filter((c) => c.targetReached), [cards]);
  const achievedMilestones = useMemo(
    () => computeMilestones(totalValue, cardCount, rareCount, ghostCount),
    [totalValue, cardCount, rareCount, ghostCount]
  );

  // Detect newly-achieved milestones (compare against localStorage record).
  const [newMilestone, setNewMilestone] = useState(null);
  useEffect(() => {
    if (loading || achievedMilestones.length === 0) return;
    const seen = new Set(JSON.parse(localStorage.getItem("scp.milestones") ?? "[]"));
    const fresh = achievedMilestones.find((m) => !seen.has(m.id));
    if (fresh) {
      setNewMilestone(fresh);
      const all = achievedMilestones.map((m) => m.id);
      localStorage.setItem("scp.milestones", JSON.stringify(all));
    }
  }, [achievedMilestones, loading]);

  // ── Sort, filter, view-mode state ──
  const [sortBy, setSortBy] = useState("date-desc");
  const [filters, setFilters] = useState({
    sport: "", grade: "", cost: "all",
    rare: false, targetHit: false,
  });
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const clearFilters = () => setFilters({ sport: "", grade: "", cost: "all", rare: false, targetHit: false });
  const filtersActive =
    filters.sport || filters.grade || filters.cost !== "all" || filters.rare || filters.targetHit;

  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "grid";
    return localStorage.getItem("scp.cardsView") === "list" ? "list" : "grid";
  });
  useEffect(() => {
    localStorage.setItem("scp.cardsView", viewMode);
  }, [viewMode]);

  const uniqueSports = useMemo(
    () => [...new Set(cards.map((c) => c.sport).filter(Boolean))].sort(),
    [cards]
  );
  const uniqueGrades = useMemo(
    () => [...new Set(cards.map((c) => c.grade).filter(Boolean))]
      .sort((a, b) => parseGrade(b) - parseGrade(a)),
    [cards]
  );

  // Split the portfolio into active (held) and past (sold or traded) sets.
  // My Collection only shows active cards; Collection History shows the rest.
  // Dashboard intentionally still summarizes the full portfolio.
  const activeCards = useMemo(
    () => cards.filter((c) => !isSold(c) && !isTraded(c)),
    [cards]
  );
  const pastCards = useMemo(
    () => cards.filter((c) => isSold(c) || isTraded(c)),
    [cards]
  );

  // Same toolbar filter+sort applied to whichever base set the active tab uses.
  const visibleCards = useMemo(
    () => applyToolbarFilters(activeCards, filters, sortBy),
    [activeCards, filters, sortBy]
  );
  const visiblePastCards = useMemo(
    () => applyToolbarFilters(pastCards, filters, sortBy),
    [pastCards, filters, sortBy]
  );

  // ── Tab routing via URL search params ──
  // Three tabs now: dashboard | collection | past. Legacy "cards" deep-links
  // (from old emails / share URLs / pre-rename code paths) silently map to
  // "collection" so they don't 404 to the dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRaw = searchParams.get("tab");
  const tab =
    tabRaw === "collection" || tabRaw === "cards" ? "collection"
    : tabRaw === "past" ? "past"
    : "dashboard";
  const highlightId = searchParams.get("highlight");

  function selectTab(next) {
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      np.set("tab", next);
      // Clearing highlight on a manual tab click feels right —
      // it should only apply when the user arrived via a deep link.
      if (next !== "collection") np.delete("highlight");
      return np;
    });
  }

  // ── Trade-completion pulse, driven by URL param ──
  // TradeDeskPage navigates to /portfolio?tab=collection&pulse=id1,id2 after
  // a confirm. Read the IDs once, drive the gold pulse, then strip the
  // param so a refresh doesn't re-trigger.
  useEffect(() => {
    const raw = searchParams.get("pulse");
    if (!raw) return;
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setPulseIds(new Set(ids));
    const t = setTimeout(() => setPulseIds(null), 3000);
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      np.delete("pulse");
      return np;
    }, { replace: true });
    return () => clearTimeout(t);
    // searchParams is referentially stable per react-router; we only
    // want this to fire when the actual pulse value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("pulse")]);

  return (
    <div style={st.page}>
      <div className="container" style={st.inner}>
        {/* ── Tab bar ── */}
        <nav style={st.tabBar}>
          <TabButton label="Dashboard"          active={tab === "dashboard"}  onClick={() => selectTab("dashboard")} />
          <TabButton label="My Collection"      active={tab === "collection"} onClick={() => selectTab("collection")} />
          <TabButton label="Collection History" active={tab === "past"}       onClick={() => selectTab("past")} />
        </nav>

        {/* ── Dashboard ── */}
        {tab === "dashboard" && (
          <>
            {(loading || cards.length > 0) && (
              <HeroStats
                totalValue={displayTotalValue}
                totalInvested={totalInvested}
                pnl={pnl}
                pnlPct={pnlPct}
                realizedPnl={realizedPnl}
                unrealizedPnl={unrealizedPnl}
                hasCost={hasCost}
                cardCount={cardCount}
                avgValue={avgValue}
                rareCount={rareCount}
                tradesExecuted={tradesExecuted}
                loading={loading}
              />
            )}

            {!loading && alerts.length > 0 && (
              <AlertBanner
                alerts={alerts}
                onJump={() => { setFilter("targetHit", true); selectTab("cards"); }}
              />
            )}

            {!loading && cards.length > 0 && (
              <>
                <AnalyticsPanel cards={cards} totalValue={displayTotalValue} />
                <PerformersPanel cards={cards} onSelectCard={(c) => setSelectedCard(c)} />
                <PriceHistoryChart history={history} />
              </>
            )}

            {loading && <DashboardSkeleton />}
            {error   && <div style={{ ...st.stateMsg, color: "#f87171" }}>Error: {error}</div>}
            {!loading && !error && cards.length === 0 && <EmptyState />}
          </>
        )}

        {/* ── My Collection ── (active cards: not sold, not traded) */}
        {tab === "collection" && (
          <>
            <div style={st.cardsBar}>
              <div>
                <p style={st.cardsBarLabel}>
                  <span style={st.heroDot} /> My Collection
                </p>
                <p style={st.cardsBarSub}>
                  Browse, filter, and manage your collection.
                </p>
              </div>
              <Link to="/add-card" style={st.cardsAddBtn}>
                <span style={st.cardsAddMark}>+</span> Add Card
              </Link>
            </div>

            {!loading && !error && activeCards.length > 0 && (
              <CardsToolbar
                sortBy={sortBy} setSortBy={setSortBy}
                filters={filters} setFilter={setFilter}
                uniqueSports={uniqueSports} uniqueGrades={uniqueGrades}
                viewMode={viewMode} setViewMode={setViewMode}
                totalCount={activeCards.length} visibleCount={visibleCards.length}
              />
            )}

            {loading ? (
              <SkeletonGrid />
            ) : error ? (
              <div style={{ ...st.stateMsg, color: "#f87171" }}>Error: {error}</div>
            ) : cards.length === 0 ? (
              <EmptyState />
            ) : activeCards.length === 0 ? (
              <AllInPastState onShowPast={() => selectTab("past")} />
            ) : visibleCards.length === 0 ? (
              <NoMatches onClear={clearFilters} />
            ) : viewMode === "list" ? (
              <CardListView
                cards={visibleCards}
                highlightId={highlightId}
                onOpen={openCardModal}
                onEdit={startEdit}
                onDelete={handleDelete}
              />
            ) : (
              <CardGrid
                visibleCards={visibleCards}
                highlightId={highlightId}
                pulseIds={pulseIds}
                onOpen={openCardModal}
                onEdit={startEdit}
                onDelete={handleDelete}
                onCardUpdate={handleCardUpdate}
              />
            )}
          </>
        )}

        {/* ── Collection History ── (sold or traded; read-only) */}
        {tab === "past" && (
          <>
            <div style={st.cardsBar}>
              <div>
                <p style={st.cardsBarLabel}>
                  <span style={st.heroDot} /> Collection History
                </p>
                <p style={st.cardsBarSub}>
                  Cards you've sold or traded away. Read-only history.
                </p>
              </div>
              {/* No Add Card button — Collection History is read-only by design. */}
            </div>

            {!loading && !error && pastCards.length > 0 && (
              <PastCollectionSummary pastCards={pastCards} />
            )}

            {!loading && !error && pastCards.length > 0 && (
              <CardsToolbar
                sortBy={sortBy} setSortBy={setSortBy}
                filters={filters} setFilter={setFilter}
                uniqueSports={uniqueSports} uniqueGrades={uniqueGrades}
                viewMode={viewMode} setViewMode={setViewMode}
                totalCount={pastCards.length} visibleCount={visiblePastCards.length}
              />
            )}

            {loading ? (
              <SkeletonGrid />
            ) : error ? (
              <div style={{ ...st.stateMsg, color: "#f87171" }}>Error: {error}</div>
            ) : pastCards.length === 0 ? (
              <NoPastCardsState />
            ) : visiblePastCards.length === 0 ? (
              <NoMatches onClear={clearFilters} />
            ) : viewMode === "list" ? (
              <CardListView
                cards={visiblePastCards}
                highlightId={highlightId}
                onOpen={openCardModal}
                onEdit={startEdit}
                onDelete={handleDelete}
                readOnly
              />
            ) : (
              <CardGrid
                visibleCards={visiblePastCards}
                highlightId={highlightId}
                pulseIds={pulseIds}
                onOpen={openCardModal}
                onEdit={startEdit}
                onDelete={handleDelete}
                onCardUpdate={handleCardUpdate}
                readOnly
              />
            )}
          </>
        )}

      </div>

      {selectedCard && (
        <CardModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onCardUpdate={handleCardUpdate}
        />
      )}
      {editingCard && (
        <EditCostModal
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSave={(patch) => {
            handleCardUpdate(editingCard.id, patch);
            setEditingCard(null);
          }}
        />
      )}
      {newMilestone && <MilestoneToast milestone={newMilestone} onDismiss={() => setNewMilestone(null)} />}
    </div>
  );
}

// ─── Hero stats bar ────────────────────────────────────────────────────
function HeroStats({ totalValue, totalInvested, pnl, pnlPct, realizedPnl, unrealizedPnl, hasCost, cardCount, avgValue, rareCount, tradesExecuted, loading }) {
  const positive = pnl != null && pnl >= 0;
  const pnlColor = positive ? "#10b981" : "#f87171";

  return (
    <header style={st.hero}>
      <div style={st.heroTopRow}>
        <div style={st.heroLabel}>
          <span style={st.heroDot} />
          <span style={st.heroLabelText}>Your Portfolio</span>
        </div>
        <div style={st.heroAccent}>◆</div>
      </div>

      {/* When cost is set, P&L gets top billing — biggest typography in the panel,
          color-coded green/red. Total value drops to a secondary metric below.
          Without cost data, fall back to the total-value-as-hero layout. */}
      {hasCost && pnl != null ? (
        <>
          <div style={st.heroPnlBlock}>
            <div style={{ ...st.heroPnlValue, color: pnlColor }}>
              {positive ? "+" : "−"}{fmtUsd(Math.abs(pnl))}
            </div>
            <div style={st.heroPnlMeta}>
              <span style={{ ...st.heroPnlPct, color: pnlColor }}>
                {positive ? "+" : "−"}{Math.abs(pnlPct).toFixed(2)}%
              </span>
              <span style={st.heroPnlLabel}>Total Return</span>
            </div>
          </div>

          {/* Realized + Unrealized split — only renders the rows that have
              data (e.g. no sold cards → no Realized line). Realized in
              green/red per direction; Unrealized in blue regardless of
              direction so it reads as "paper gains" distinct from realized. */}
          {(realizedPnl != null || unrealizedPnl != null) && (
            <div style={st.heroSplitRow}>
              {realizedPnl != null && (
                <div style={st.heroSplitItem}>
                  <span style={st.heroSplitLabel}>Realized</span>
                  <span style={{
                    ...st.heroSplitValue,
                    color: realizedPnl >= 0 ? "#10b981" : "#f87171",
                  }}>
                    {realizedPnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(realizedPnl))}
                  </span>
                </div>
              )}
              {unrealizedPnl != null && (
                <div style={st.heroSplitItem}>
                  <span style={st.heroSplitLabel}>Unrealized</span>
                  <span style={{ ...st.heroSplitValue, color: "#60a5fa" }}>
                    {unrealizedPnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(unrealizedPnl))}
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={st.heroDivider} />

          <div style={st.statsRow4}>
            <Stat
              label="Portfolio Value"
              value={totalValue !== null ? fmtUsd(totalValue) : "—"}
              accent
            />
            <Stat label="Invested" value={fmtUsd(totalInvested)} />
            <Stat label="Cards" value={cardCount.toLocaleString()} />
            <Stat label="Rare" value={rareCount} accent={rareCount > 0} />
            <Stat label="Trades" value={tradesExecuted.toLocaleString()} accent={tradesExecuted > 0} />
          </div>
        </>
      ) : (
        <>
          <div style={st.heroValue}>
            {loading ? "—" : (totalValue !== null ? fmtUsd(totalValue) : "—")}
          </div>
          <div style={st.heroSubLabel}>Total Portfolio Value</div>

          <div style={st.heroDivider} />

          <div style={st.statsRow}>
            <Stat label="Cards" value={loading ? "—" : cardCount.toLocaleString()} />
            <Stat label="Avg Card Value" value={avgValue != null ? fmtUsd(avgValue) : "—"} />
            <Stat label="Rare Cards" value={loading ? "—" : rareCount} accent={rareCount > 0} />
            <Stat label="Trades" value={loading ? "—" : tradesExecuted.toLocaleString()} accent={tradesExecuted > 0} />
          </div>
        </>
      )}
    </header>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={st.stat}>
      <div style={{ ...st.statValue, ...(accent ? st.statValueAccent : {}) }}>{value}</div>
      <div style={st.statLabel}>{label}</div>
    </div>
  );
}

// ─── Analytics panel ──────────────────────────────────────────────────
function computeAllocation(cards) {
  const buckets = new Map();
  cards.forEach((card) => {
    const value = card.estimatedValue ?? 0;
    if (!value || value <= 0) return;
    const key = card.sport || "Uncategorized";
    buckets.set(key, (buckets.get(key) ?? 0) + value);
  });
  const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return Array.from(buckets.entries())
    .map(([name, value]) => ({ name, value, percent: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
}

function AnalyticsPanel({ cards, totalValue }) {
  const data = useMemo(() => computeAllocation(cards), [cards]);
  const [activeIdx, setActiveIdx] = useState(null);

  if (data.length === 0) return null;

  return (
    <section style={st.analytics}>
      <div style={st.analyticsHeader}>
        <div>
          <p style={st.analyticsEyebrow}>Portfolio Allocation</p>
          <p style={st.analyticsSub}>
            Distribution by category · {data.length} categor{data.length === 1 ? "y" : "ies"}
          </p>
        </div>
        <span style={st.analyticsAccent}>◆</span>
      </div>

      <div style={st.analyticsBody}>
        {/* ── Donut chart ── */}
        <div style={st.chartWrap}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={72}
                outerRadius={110}
                paddingAngle={1.5}
                stroke="#070a14"
                strokeWidth={2}
                onMouseEnter={(_, i) => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
                isAnimationActive={false}
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={PALETTE[i % PALETTE.length]}
                    style={{
                      transition: "opacity 0.2s",
                      opacity: activeIdx === null || activeIdx === i ? 1 : 0.3,
                      cursor: "pointer",
                      filter: activeIdx === i ? "drop-shadow(0 0 12px currentColor)" : "none",
                    }}
                  />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} cursor={false} />
            </PieChart>
          </ResponsiveContainer>

          {/* Centre badge inside the donut */}
          <div style={st.donutCenter}>
            <div style={st.donutCenterLabel}>Total</div>
            <div style={st.donutCenterValue}>
              {totalValue != null ? fmtUsd(totalValue) : "—"}
            </div>
          </div>
        </div>

        {/* ── Legend ── */}
        <div style={st.legend}>
          {data.map((item, i) => {
            const active = activeIdx === i;
            const dim    = activeIdx !== null && !active;
            return (
              <div
                key={item.name}
                style={{
                  ...st.legendRow,
                  ...(active ? st.legendRowActive : {}),
                  opacity: dim ? 0.4 : 1,
                }}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                <span style={{ ...st.legendDot, background: PALETTE[i % PALETTE.length] }} />
                <span style={st.legendName}>{item.name}</span>
                <span style={st.legendValue}>{fmtUsd(item.value)}</span>
                <span style={st.legendPct}>{item.percent.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div style={st.tooltip}>
      <div style={st.tooltipName}>{item.name}</div>
      <div style={st.tooltipValue}>{fmtUsd(item.value)}</div>
      <div style={st.tooltipPct}>{item.percent.toFixed(1)}% of portfolio</div>
    </div>
  );
}

// ─── Sort + filter helpers ────────────────────────────────────────────
const SORT_OPTIONS = [
  { value: "date-desc",  label: "Newest first" },
  { value: "date-asc",   label: "Oldest first" },
  { value: "name-asc",   label: "Player name (A–Z)" },
  { value: "grade-desc", label: "Grade (PSA 10 first)" },
  { value: "value-desc", label: "Value (high to low)" },
  { value: "value-asc",  label: "Value (low to high)" },
  { value: "pnl-desc",   label: "P/L (best first)" },
  { value: "cost-desc",  label: "Cost (high to low)" },
];

function parseGrade(g) {
  if (!g) return -1;
  // PSA grades are typically "10", "9", "9.5", but some include text like "AUTO 10".
  // Pull the first numeric run; fall back to -1 if none present.
  const m = String(g).match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : -1;
}

function pnlOf(c) {
  // Sort uses the same realized-vs-unrealized split as displays: sold cards
  // ranked by soldPrice - cost, others by estimatedValue - cost.
  const v = cardPnl(c);
  return v == null ? -Infinity : v;
}

function sortCards(cards, sortBy) {
  const out = [...cards];
  switch (sortBy) {
    case "name-asc":
      return out.sort((a, b) => (a.playerName ?? "").localeCompare(b.playerName ?? ""));
    case "grade-desc":
      return out.sort((a, b) => parseGrade(b.grade) - parseGrade(a.grade));
    case "value-desc":
      return out.sort((a, b) => (effectiveValue(b) ?? 0) - (effectiveValue(a) ?? 0));
    case "value-asc":
      return out.sort((a, b) => (effectiveValue(a) ?? 0) - (effectiveValue(b) ?? 0));
    case "pnl-desc":
      return out.sort((a, b) => pnlOf(b) - pnlOf(a));
    case "date-asc":
      return out.sort((a, b) => new Date(a.addedAt ?? 0) - new Date(b.addedAt ?? 0));
    case "cost-desc":
      return out.sort((a, b) => (b.myCost ?? -Infinity) - (a.myCost ?? -Infinity));
    case "date-desc":
    default:
      return out.sort((a, b) => new Date(b.addedAt ?? 0) - new Date(a.addedAt ?? 0));
  }
}

// Toolbar filter chain + sort, applied to either the active or past set.
// Module-scope so it can be referenced from both useMemos without juggling
// useCallback deps. Same semantics that My Collection has always used.
function applyToolbarFilters(base, filters, sortBy) {
  let out = base;
  if (filters.sport)          out = out.filter((c) => c.sport === filters.sport);
  if (filters.grade)          out = out.filter((c) => c.grade === filters.grade);
  if (filters.rare)           out = out.filter(isRare);
  if (filters.targetHit)      out = out.filter((c) => c.targetReached);
  if (filters.cost === "has") out = out.filter((c) => c.myCost != null);
  if (filters.cost === "no")  out = out.filter((c) => c.myCost == null);
  return sortCards(out, sortBy);
}

// ─── Cards toolbar (sort + filters + view toggle) ─────────────────────
function CardsToolbar({
  sortBy, setSortBy, filters, setFilter,
  uniqueSports, uniqueGrades,
  viewMode, setViewMode,
  totalCount, visibleCount,
}) {
  return (
    <div style={st.toolbar}>
      <ToolbarSelect
        value={sortBy} onChange={setSortBy}
        options={SORT_OPTIONS}
      />
      <ToolbarSelect
        value={filters.sport} onChange={(v) => setFilter("sport", v)}
        options={[{ value: "", label: "All Sports" }, ...uniqueSports.map((s) => ({ value: s, label: s }))]}
      />
      <ToolbarSelect
        value={filters.grade} onChange={(v) => setFilter("grade", v)}
        options={[{ value: "", label: "All Grades" }, ...uniqueGrades.map((g) => ({ value: g, label: `PSA ${g}` }))]}
      />
      <ToolbarSelect
        value={filters.cost} onChange={(v) => setFilter("cost", v)}
        options={[
          { value: "all", label: "All Cards" },
          { value: "has", label: "With Cost" },
          { value: "no",  label: "No Cost" },
        ]}
      />
      <TogglePill label="Rare"       active={filters.rare}      onChange={(v) => setFilter("rare", v)} />
      <TogglePill label="Target Hit" active={filters.targetHit} onChange={(v) => setFilter("targetHit", v)} />

      <span style={st.toolbarSpacer} />

      <span style={st.toolbarCount}>
        {visibleCount === totalCount
          ? `${totalCount} card${totalCount === 1 ? "" : "s"}`
          : `${visibleCount} of ${totalCount}`}
      </span>

      <ViewToggle mode={viewMode} setMode={setViewMode} />
    </div>
  );
}

function ToolbarSelect({ value, onChange, options }) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ ...st.select, ...(focused ? st.selectFocused : {}) }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={st.selectOption}>{o.label}</option>
      ))}
    </select>
  );
}

function TogglePill({ label, active, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      style={{ ...st.togglePill, ...(active ? st.togglePillActive : {}) }}
    >
      {active && <span style={st.toggleDot} />}
      {label}
    </button>
  );
}

function ViewToggle({ mode, setMode }) {
  return (
    <div style={st.viewToggle}>
      <button
        type="button" onClick={() => setMode("grid")} title="Grid view"
        style={{ ...st.viewBtn, ...(mode === "grid" ? st.viewBtnActive : {}) }}
        aria-label="Grid view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="1.5" y="1.5" width="5.5" height="5.5" />
          <rect x="9"   y="1.5" width="5.5" height="5.5" />
          <rect x="1.5" y="9"   width="5.5" height="5.5" />
          <rect x="9"   y="9"   width="5.5" height="5.5" />
        </svg>
      </button>
      <button
        type="button" onClick={() => setMode("list")} title="List view"
        style={{ ...st.viewBtn, ...(mode === "list" ? st.viewBtnActive : {}) }}
        aria-label="List view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="2" y1="4"  x2="14" y2="4"  />
          <line x1="2" y1="8"  x2="14" y2="8"  />
          <line x1="2" y1="12" x2="14" y2="12" />
        </svg>
      </button>
    </div>
  );
}

function NoMatches({ onClear }) {
  return (
    <div style={st.noMatches}>
      <div style={st.noMatchesIcon}>⌖</div>
      <div style={st.noMatchesTitle}>No cards match these filters</div>
      <button onClick={onClear} style={st.noMatchesBtn} type="button">Clear filters</button>
    </div>
  );
}

// ─── List view ────────────────────────────────────────────────────────
function CardListView({ cards, highlightId, onOpen, onEdit, onDelete, readOnly = false }) {
  // Pre-compute the comparison side once per parent render — the map
  // body then does a single string equality per row instead of two
  // String() conversions.
  const highlightIdStr = highlightId == null ? null : String(highlightId);
  return (
    <div style={st.listOuter}>
      <div style={st.list}>
        <div style={st.listHeader}>
          <span /> {/* thumbnail column */}
          <span style={st.listHeadCell}>Player</span>
          <span style={st.listHeadCell}>Year</span>
          <span style={st.listHeadCell}>Brand</span>
          <span style={st.listHeadCell}>Grade</span>
          <span style={{ ...st.listHeadCell, textAlign: "right" }}>Cost</span>
          <span style={{ ...st.listHeadCell, textAlign: "right" }}>Value</span>
          <span style={{ ...st.listHeadCell, textAlign: "right" }}>P/L</span>
          <span />
        </div>
        {cards.map((card) => (
          <CardListRow
            key={card.id}
            card={card}
            highlighted={String(card.id) === highlightIdStr}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function CardListRowImpl({ card, highlighted, onOpen, onEdit, onDelete, readOnly = false }) {
  const [hovered, setHovered] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [imgErr, setImgErr]   = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    if (!highlighted || !rowRef.current) return;
    rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 4500);
    return () => clearTimeout(t);
  }, [highlighted]);

  const sold = isSold(card);
  const value = effectiveValue(card);
  const pnl = cardPnl(card);
  const pnlPositive = pnl != null && pnl >= 0;
  const tier = getRarityTier(card);

  return (
    <div
      ref={rowRef}
      style={{
        ...st.listRow,
        ...(hovered ? st.listRowHovered : {}),
        ...(pulsing ? st.listRowHighlight : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(card)}
    >
      <div style={st.listThumbWrap}>
        {card.imageUrl && !imgErr ? (
          <img
            src={card.imageUrl} alt=""
            style={st.listThumb}
            loading="lazy"
            onError={() => setImgErr(true)}
            draggable={false}
          />
        ) : (
          <div style={st.listThumbEmpty}>🃏</div>
        )}
      </div>

      <div style={st.listNameCell}>
        <div style={st.listNameTop}>
          <span style={st.listNameMain}>{card.playerName ?? "Unknown"}</span>
          {tier && <TierFlag tier={tier} />}
          {sold && <span style={st.listFlagSold}>SOLD</span>}
          {isTraded(card) && <span style={st.listFlagTraded}>TRADED</span>}
          {!sold && !isTraded(card) && card.targetReached && <span style={st.listFlagTarget}>TARGET</span>}
        </div>
        <div style={st.listNameMeta}>
          {card.cardNumber ? `#${card.cardNumber} · ` : ""}Cert {card.certNumber}
        </div>
      </div>

      <div style={st.listCell}>{card.year ?? "—"}</div>
      <div style={st.listCell}>{card.brand ?? "—"}</div>
      <div><span style={st.listGradeBadge}>PSA {card.grade}</span></div>

      <div style={{ ...st.listCell, ...st.listMoney, textAlign: "right" }}>
        {card.myCost != null ? fmtUsd(card.myCost) : "—"}
      </div>
      {/* Sold cards show their realized soldPrice in green; held cards show
          estimatedValue in gold. */}
      <div style={{
        ...st.listCell, ...st.listMoney,
        textAlign: "right",
        color: sold ? "#6ee7b7" : "#f59e0b",
        fontWeight: 700,
      }}>
        {value != null ? fmtUsd(value) : "—"}
      </div>
      <div style={{ ...st.listCell, ...st.listMoney, textAlign: "right" }}>
        {pnl != null ? (
          <span style={{ color: pnlPositive ? "#10b981" : "#f87171", fontWeight: 800 }}>
            {pnlPositive ? "+" : "−"}{fmtUsd(Math.abs(pnl))}
          </span>
        ) : <span style={{ color: "#475569" }}>—</span>}
      </div>

      {/* Action cell — kept in the row so the grid column count matches the
          header even when read-only (Collection History has no edit/delete). */}
      <div style={st.listActions}>
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(card); }}
              style={st.listActionEdit}
              title="Edit cost"
              aria-label="Edit cost"
            >✎</button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
              style={st.listActionDel}
              title="Remove card"
              aria-label="Remove card"
            >✕</button>
          </>
        )}
      </div>
    </div>
  );
}
const CardListRow = memo(CardListRowImpl);

// ─── Tab button ───────────────────────────────────────────────────────
function TabButton({ label, active, onClick, badge }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...st.tab,
        ...(active ? st.tabActive : (hovered ? st.tabHover : {})),
      }}
      type="button"
    >
      {label}
      {badge != null && (
        <span style={{ ...st.tabBadge, ...(active ? st.tabBadgeActive : {}) }}>{badge}</span>
      )}
    </button>
  );
}

// ─── Edit cost modal ──────────────────────────────────────────────────
function EditCostModal({ card, onClose, onSave }) {
  const [val, setVal]                 = useState(card.myCost != null ? String(card.myCost) : "");
  const [targetVal, setTargetVal]     = useState(card.targetPrice != null ? String(card.targetPrice) : "");
  const [focused, setFocused]         = useState(false);
  const [targetFocused, setTargetFocused] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    const cost   = parseOptional(val);
    const target = parseOptional(targetVal);
    if (cost   === "INVALID") return setError("Cost must be a non-negative number");
    if (target === "INVALID") return setError("Target price must be a non-negative number");

    setSaving(true);
    try {
      const updated = await updateCard(card.id, { myCost: cost, targetPrice: target });
      // Recompute targetReached locally so the tile updates immediately.
      const reached = updated.targetPrice != null && card.estimatedValue != null
        && card.estimatedValue >= updated.targetPrice;
      onSave({ myCost: updated.myCost, targetPrice: updated.targetPrice, targetReached: reached });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }

  // Live profit/loss preview as the user types
  const pendingCost = val.trim() === "" ? null : parseFloat(val.trim());
  const validPending = pendingCost !== null && !isNaN(pendingCost) && pendingCost >= 0;
  const liveValue   = card.estimatedValue;
  const livePnl     = validPending && liveValue != null ? liveValue - pendingCost : null;
  const livePositive = livePnl != null && livePnl >= 0;

  return (
    <div style={st.editBackdrop} onClick={handleBackdrop}>
      <form style={st.editModal} onSubmit={handleSave}>
        <button type="button" style={st.editClose} onClick={onClose} aria-label="Close">✕</button>

        <div style={st.editHeader}>
          <p style={st.editEyebrow}>
            <span style={st.eyebrowMark}>◆</span> Edit Cost
          </p>
          <h2 style={st.editTitle}>{card.playerName ?? "Card"}</h2>
          <p style={st.editSub}>
            {[card.year, card.brand, `PSA ${card.grade}`].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div style={st.editDivider} />

        <label style={st.editFieldLabel}>Your Cost</label>
        <div style={{ ...st.costInputWrap, ...(focused ? st.costInputWrapFocused : {}) }}>
          <span style={st.costDollarLg}>$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={saving}
            autoFocus
            style={st.costInputLg}
          />
        </div>
        <p style={st.editHint}>
          Leave blank to clear your cost basis.
        </p>

        <label style={{ ...st.editFieldLabel, marginTop: "1.25rem" }}>Target Price</label>
        <div style={{ ...st.costInputWrap, ...(targetFocused ? st.costInputWrapFocused : {}) }}>
          <span style={st.costDollarLg}>$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={targetVal}
            onChange={(e) => setTargetVal(e.target.value)}
            onFocus={() => setTargetFocused(true)}
            onBlur={() => setTargetFocused(false)}
            disabled={saving}
            style={st.costInputLg}
          />
        </div>
        <p style={st.editHint}>
          Get a notification when the card's market value reaches this price.
        </p>

        {/* Live P&L preview */}
        {validPending && livePnl != null && (
          <div style={{
            ...st.editPreview,
            color: livePositive ? "#10b981" : "#f87171",
            borderColor: livePositive ? "rgba(16,185,129,0.3)" : "rgba(248,113,113,0.3)",
          }}>
            <span style={st.editPreviewLabel}>Projected P/L</span>
            <span style={st.editPreviewValue}>
              {livePositive ? "+" : "−"}{fmtUsd(Math.abs(livePnl))}
            </span>
          </div>
        )}

        {error && <div style={st.editError}>{error}</div>}

        <div style={st.editFooter}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={st.editCancel}
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} style={st.editSave}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────
// Skeleton loader for the cards grid — renders eight placeholder tiles
// that match the real CardTile dimensions (5/7 image + body) so the grid
// layout is locked in immediately and there's no layout shift when real
// data arrives. Shimmer band is driven by `skeletonShimmer` in index.css.
function SkeletonTile() {
  return (
    <div style={st.skeletonTile}>
      <div style={st.skeletonImage} />
      <div style={st.skeletonBody}>
        <div style={st.skeletonLine} />
        <div style={{ ...st.skeletonLine, width: "60%" }} />
        <div style={{ ...st.skeletonLine, width: "40%", marginTop: "0.4rem" }} />
      </div>
    </div>
  );
}

function SkeletonGrid({ count = 8 }) {
  return (
    <div style={st.grid}>
      {Array.from({ length: count }).map((_, i) => <SkeletonTile key={i} />)}
    </div>
  );
}

// Dashboard skeleton — shown beneath HeroStats (which has its own "—"
// placeholders) while the fast read is in flight. Two analytics panels
// side-by-side on top, full-width chart below — same proportions as the
// real layout so the page doesn't shift when data arrives.
function DashboardSkeleton() {
  return (
    <>
      <div style={st.skeletonAnalyticsRow}>
        <div style={st.skeletonPanel}>
          <div style={{ ...st.skeletonLine, width: "40%", height: "1rem" }} />
          <div style={st.skeletonChartArea} />
        </div>
        <div style={st.skeletonPanel}>
          <div style={{ ...st.skeletonLine, width: "40%", height: "1rem" }} />
          <div style={st.skeletonChartArea} />
        </div>
      </div>
      <div style={{ ...st.skeletonPanel, marginTop: "1.5rem" }}>
        <div style={{ ...st.skeletonLine, width: "30%", height: "1rem" }} />
        <div style={{ ...st.skeletonChartArea, height: 240 }} />
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div style={st.empty}>
      <div style={st.emptyIcon}>◆</div>
      <h2 style={st.emptyTitle}>Your collection is empty</h2>
      <p style={st.emptySub}>Add your first PSA-graded card to start tracking your portfolio.</p>
      <Link to="/add-card" style={st.emptyCta}>
        <span style={st.cardsAddMark}>+</span> Add Card
      </Link>
    </div>
  );
}

// Shown on the My Collection tab when every card has been sold or traded.
// Cards still exist in the portfolio (dashboard summary picks them up); they
// just don't belong on the active-collection view.
function AllInPastState({ onShowPast }) {
  return (
    <div style={st.empty}>
      <div style={st.emptyIcon}>◆</div>
      <h2 style={st.emptyTitle}>No cards in your active collection</h2>
      <p style={st.emptySub}>
        Every card you've added has been sold or traded — view them in Collection History.
      </p>
      <button type="button" onClick={onShowPast} style={st.emptyCtaBtn}>
        View Collection History →
      </button>
    </div>
  );
}

// Shown on the Collection History tab when the user hasn't sold or traded
// anything yet. Distinct from EmptyState because the user may still have an
// active collection — they just don't have any "past" entries.
function NoPastCardsState() {
  return (
    <div style={st.empty}>
      <div style={st.emptyIcon}>◆</div>
      <h2 style={st.emptyTitle}>No collection history yet</h2>
      <p style={st.emptySub}>Cards you sell or trade away will appear here as a permanent history.</p>
    </div>
  );
}

// Three-stat strip at the top of Collection History: cards sold, realized
// P&L (sum of soldPrice − myCost where both present), cards traded. Mirrors
// the Editorial Dark hero aesthetic — flat surface, hairline divider, gold
// reserved for the realized number when it's a positive exit.
function PastCollectionSummary({ pastCards }) {
  const stats = useMemo(() => {
    let soldCount = 0, tradedCount = 0, realizedPnl = 0, hasRealizedCost = false;
    for (const c of pastCards) {
      if (isSold(c)) {
        soldCount += 1;
        if (c.myCost != null) {
          realizedPnl += c.consignmentSoldPrice - c.myCost;
          hasRealizedCost = true;
        }
      }
      if (isTraded(c)) tradedCount += 1;
    }
    return { soldCount, tradedCount, realizedPnl, hasRealizedCost };
  }, [pastCards]);

  const positive = stats.realizedPnl >= 0;
  const pnlColor = positive ? "#10b981" : "#f87171";
  const pnlText = stats.hasRealizedCost
    ? `${positive ? "+" : "−"}${fmtUsd(Math.abs(stats.realizedPnl))}`
    : "—";

  return (
    <div style={st.pastSummary}>
      <div style={st.pastSummaryItem}>
        <div style={st.pastSummaryValue}>{stats.soldCount.toLocaleString()}</div>
        <div style={st.pastSummaryLabel}>Total Cards Sold</div>
      </div>
      <div style={st.pastSummaryDivider} />
      <div style={st.pastSummaryItem}>
        <div style={{ ...st.pastSummaryValue, color: stats.hasRealizedCost ? pnlColor : "#94a3b8" }}>
          {pnlText}
        </div>
        <div style={st.pastSummaryLabel}>Total Realized P&amp;L</div>
      </div>
      <div style={st.pastSummaryDivider} />
      <div style={st.pastSummaryItem}>
        <div style={st.pastSummaryValue}>{stats.tradedCount.toLocaleString()}</div>
        <div style={st.pastSummaryLabel}>Total Cards Traded</div>
      </div>
    </div>
  );
}

// ─── Tier badges ──────────────────────────────────────────────────────
// Grid-tile ribbon. Ghost renders as a bare floating icon (no pill); the
// other two tiers use a text pill in their tier colour.
function TierRibbonImpl({ tier }) {
  if (tier === "ghost") {
    return (
      <div style={st.ghostBadgeTile}>
        <GhostIcon size={32} />
      </div>
    );
  }
  const variant = tier === "ultra_rare" ? st.tierRibbonUltraRare : st.tierRibbonRare;
  return <div style={{ ...st.tierRibbonBase, ...variant }}>{TIER_LABELS[tier]}</div>;
}
const TierRibbon = memo(TierRibbonImpl);

// Inline flag used in list rows + performer rows. Ghost is icon-only here too.
function TierFlagImpl({ tier }) {
  if (tier === "ghost") {
    return (
      <span style={st.ghostBadgeInline}>
        <GhostIcon size={16} />
      </span>
    );
  }
  const variant = tier === "ultra_rare" ? st.tierFlagUltraRare : st.tierFlagRare;
  return <span style={{ ...st.tierFlagBase, ...variant }}>{TIER_LABELS[tier]}</span>;
}
const TierFlag = memo(TierFlagImpl);

// Border-tint applied to tiles per tier. Pre-computed at module scope
// so the spread inside CardTile's render is by-reference — keeps
// React.memo's prop-equality check on style-shaped values cheap, and
// avoids allocating a new object on every CardTile render.
const TIER_TILE_STYLES = {
  ultra_rare: { borderColor: "rgba(245,158,11,0.4)" },
  ghost:      { borderColor: "rgba(255,255,255,0.32)" },
  rare:       { borderColor: "rgba(147,197,253,0.4)" },
};
const EMPTY_TIER_STYLE = {};
function tileTierStyle(tier) {
  return TIER_TILE_STYLES[tier] ?? EMPTY_TIER_STYLE;
}

// ─── Card tile ────────────────────────────────────────────────────────
// Wrapped in React.memo at the bottom of the function; combined with
// the stable callbacks from PortfolioPage (openCardModal / startEdit /
// handleDelete / handleCardUpdate), only tiles whose own props actually
// change get re-rendered.
// IntersectionObserver-based virtualization wrapper. Tiles render a
// minimum-height placeholder until they're within `rootMargin` of the
// viewport, at which point the real CardTile mounts and stays mounted
// (mount-once semantics — keeps scroll-back instantaneous and avoids
// flicker when the user scrolls fast). With ~360px placeholder height
// and 400px root margin, even 200-card portfolios feel responsive on
// initial render because most tiles are non-visible at mount.
function LazyTile({ children, placeholderHeight = 360 }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (visible) return; // sticky once visible — no need to keep observing
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // SSR / older browsers / test envs — render eagerly.
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} style={visible ? undefined : { minHeight: placeholderHeight }}>
      {visible ? children : null}
    </div>
  );
}

// Memoized grid wrapper. highlightIdStr is computed ONCE per parent
// render here, instead of running String() inside every map iteration.
function CardGridImpl({ visibleCards, highlightId, pulseIds, onOpen, onEdit, onDelete, onCardUpdate, readOnly = false }) {
  const highlightIdStr = highlightId == null ? null : String(highlightId);
  return (
    <div style={st.grid}>
      {visibleCards.map((card, idx) => (
        <LazyTile key={card.id}>
          <CardTile
            card={card}
            index={idx}
            highlighted={String(card.id) === highlightIdStr}
            pulse={pulseIds?.has(card.id) ?? false}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
            onCardUpdate={onCardUpdate}
            readOnly={readOnly}
          />
        </LazyTile>
      ))}
    </div>
  );
}
const CardGrid = memo(CardGridImpl);

function CardTileImpl({ card, index, highlighted, pulse, onOpen, onEdit, onDelete, onCardUpdate, readOnly = false }) {
  const [hovered, setHovered] = useState(false);
  const [imgErr, setImgErr]   = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [tradePulsing, setTradePulsing] = useState(false);
  const tileRef = useRef(null);
  const tier = getRarityTier(card);

  // Scroll into view + run a temporary gold pulse when this tile is the
  // target of a deep-link highlight (e.g. duplicate-cert detection redirect).
  useEffect(() => {
    if (!highlighted || !tileRef.current) return;
    tileRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 4500);
    return () => clearTimeout(t);
  }, [highlighted]);

  // Trade-completion pulse — set by parent after a trade confirms. No
  // scroll (the grid sorts newly-added cards to the top), just a 3s
  // gold ring so the user can spot the cards they just received among
  // the rest of their portfolio.
  useEffect(() => {
    if (!pulse) return;
    setTradePulsing(true);
    const t = setTimeout(() => setTradePulsing(false), 3000);
    return () => clearTimeout(t);
  }, [pulse]);

  return (
    <div
      ref={tileRef}
      style={{
        ...st.tile,
        ...(tier ? tileTierStyle(tier) : {}),
        ...(hovered ? st.tileHovered : {}),
        ...(pulsing ? st.tileHighlight : {}),
        ...(tradePulsing ? st.tileTradePulse : {}),
        animationDelay: `${Math.min(index * 35, 600)}ms`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(card)}
    >
      {/* Image area */}
      <div style={st.imageWrap}>
        {card.imageUrl && !imgErr ? (
          <img
            src={card.imageUrl}
            alt={card.playerName ?? "Card"}
            style={st.image}
            loading="lazy"
            onError={() => setImgErr(true)}
            draggable={false}
          />
        ) : (
          <div style={st.imageFallback}>
            <span style={st.imageFallbackIcon}>🃏</span>
            <span style={st.imageFallbackText}>No image</span>
          </div>
        )}

        {/* Top-right hover overlay: edit + delete. Collection History passes
            readOnly so sold/traded cards don't expose mutating actions. */}
        {!readOnly && (
          <div style={{ ...st.tileActions, opacity: hovered ? 1 : 0 }}>
            <button
              style={st.editBtn}
              onClick={(e) => { e.stopPropagation(); onEdit(card); }}
              title="Edit cost"
              aria-label="Edit cost"
            >✎</button>
            <button
              style={st.deleteBtn}
              onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
              title="Remove card"
              aria-label="Remove card"
            >✕</button>
          </div>
        )}

        {/* Bottom-left grade badge — grader logo + grade. PSA gets the
            stickered AVIF; BGS / SGC get a text badge (no licensed
            assets). Falls back to PSA for legacy rows missing grader. */}
        <div style={st.gradeBadge}>
          {(card.grader ?? "PSA") === "PSA"
            ? <img src="/psa.avif" alt="PSA" loading="lazy" style={st.gradeBadgeLogo} />
            : <span style={st.gradeBadgeText}>{card.grader}</span>}
          <span style={st.gradeBadgeValue}>{card.grade}</span>
        </div>

        {/* Rarity ribbon — Ghost / Ultra Rare / Rare */}
        {tier && <TierRibbon tier={tier} />}

        {/* SOLD diagonal stamp — takes precedence over target-hit since the
            card is no longer in active portfolio rotation. */}
        {isSold(card) && <div style={st.soldStamp}>SOLD</div>}
        {isTraded(card) && <div style={st.tradedStamp}>TRADED</div>}

        {/* Target-reached pulsing badge — suppressed for sold or traded
            cards (both removed from active portfolio rotation). */}
        {!isSold(card) && !isTraded(card) && card.targetReached && (
          <div style={st.targetBadge} title={`Target hit · $${card.targetPrice}`}>
            <span style={st.targetBadgeDot} />
            TARGET HIT
          </div>
        )}

        {/* Subtle gradient overlay for image polish */}
        <div style={st.imageGradient} />
      </div>

      {/* Slim info bar */}
      <div style={st.infoBar}>
        <div style={st.infoTopRow}>
          <div style={st.playerName} title={card.playerName ?? ""}>
            {card.playerName ?? "Unknown Player"}
          </div>
          <div style={st.metaRight}>
            {[card.year, card.brand].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div style={st.infoBottomRow}>
          <PricingValue card={card} onCardUpdate={onCardUpdate} />
          <PopBadge card={card} />
        </div>
        <CostLine card={card} />
      </div>
    </div>
  );
}
const CardTile = memo(CardTileImpl);

// Slim P&L line under the value — only renders when myCost is set.
// Sold cards label this "Realized" with green/red P&L; held cards use
// the implicit "unrealized" reading and color-code the same way for
// per-card legibility (the realized vs unrealized split is most useful
// at the portfolio level, not per-tile).
function CostLine({ card }) {
  if (card.myCost == null) return null;
  const sold     = isSold(card);
  const pnl      = cardPnl(card);
  const positive = pnl != null && pnl >= 0;
  const arrow    = positive ? "↑" : "↓";
  return (
    <div style={st.costLine}>
      <span style={st.costLineLabel}>{sold ? "Realized" : "Cost"}</span>
      <span style={st.costLineValue}>{fmtUsd(card.myCost)}</span>
      {pnl != null && (
        <span style={{
          ...st.costLinePnl,
          color: positive ? "#10b981" : "#f87171",
        }}>
          {arrow} {fmtUsd(Math.abs(pnl))}
        </span>
      )}
    </div>
  );
}

// ─── Population badge (compact, in-tile) ──────────────────────────────
function PopBadge({ card }) {
  if (card.psaPopulation == null && card.psaPopulationHigher == null) return null;
  const higherZero = card.psaPopulationHigher === 0;
  return (
    <div style={st.popBadge} title="PSA population data">
      {card.psaPopulation != null && (
        <span>Pop {card.psaPopulation.toLocaleString()}</span>
      )}
      {card.psaPopulationHigher != null && (
        <>
          <span style={st.popBadgeDot}>·</span>
          <span style={higherZero ? st.popBadgeHigherZero : {}}>
            {higherZero ? "Highest Graded" : `Higher: ${card.psaPopulationHigher.toLocaleString()}`}
          </span>
        </>
      )}
    </div>
  );
}

// ─── Pricing value with inline edit ───────────────────────────────────
function PricingValue({ card, onCardUpdate }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState("");
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    const cur = card.manualPrice ?? card.estimatedValue ?? "";
    setVal(cur !== "" ? String(parseFloat(cur).toFixed(2)) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancel(e) {
    e?.stopPropagation();
    setEditing(false);
    setVal("");
  }

  async function commit(e) {
    e?.stopPropagation();
    const trimmed = val.trim();
    if (trimmed === "") return cancel();
    const n = parseFloat(trimmed);
    if (isNaN(n) || n < 0) return cancel();
    setSaving(true);
    try {
      await updateCardPrice(card.id, n);
      onCardUpdate(card.id, { manualPrice: n, estimatedValue: n, priceSource: "manual" });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // For sold cards, show the realized soldPrice — never editable, never the
  // stale estimatedValue. For everything else, the existing manual/auto
  // chain holds.
  const sold = isSold(card);
  const display = sold ? card.consignmentSoldPrice : (card.estimatedValue ?? card.avgSalePrice);

  // Sold cards short-circuit the editor: the realized price is fixed.
  if (sold) {
    return (
      <span style={st.priceSold} title="Realized sale price">
        {fmtUsd(display)}
      </span>
    );
  }

  if (editing) {
    return (
      <div style={st.editBlock} onClick={(e) => e.stopPropagation()}>
        <span style={st.editDollar}>$</span>
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e);
            if (e.key === "Escape") cancel(e);
          }}
          disabled={saving}
          style={st.editInput}
          autoFocus
        />
        <button onClick={commit} disabled={saving} style={st.editOk} title="Save">✓</button>
        <button onClick={cancel} disabled={saving} style={st.editX}  title="Cancel">✕</button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      style={display != null ? st.priceBtn : st.priceBtnEmpty}
      title="Click to set price"
    >
      {display != null ? fmtUsd(display) : "Set price"}
    </button>
  );
}

// ─── Helpers for new features ─────────────────────────────────────────
function parseOptional(raw) {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  if (isNaN(n) || n < 0) return "INVALID";
  return n;
}

// ─── Alert banner — target prices reached ─────────────────────────────
function AlertBanner({ alerts, onJump }) {
  const n = alerts.length;
  return (
    <section style={st.alertBanner}>
      <div style={st.alertHeader}>
        <span style={st.alertDot} />
        <span style={st.alertEyebrow}>
          {n} card{n === 1 ? "" : "s"} hit target price
        </span>
        {onJump && (
          <button onClick={onJump} style={st.alertJump} type="button">
            View →
          </button>
        )}
      </div>
    </section>
  );
}


// ─── Top / bottom performers ──────────────────────────────────────────
function PerformersPanel({ cards, onSelectCard }) {
  const tracked = useMemo(() => {
    return cards
      .filter((c) => c.myCost != null && c.estimatedValue != null)
      .map((c) => ({ ...c, pnl: c.estimatedValue - c.myCost }));
  }, [cards]);

  // Partition by sign, sort each side, take 3. Wrapped in useMemo
  // because the partition + two sorts are O(n log n) and the dashboard
  // re-renders on unrelated state changes (selected card, pulse
  // timers). Break-even cards (pnl === 0) appear in neither column.
  const { gainers, losers } = useMemo(() => {
    return {
      gainers: tracked
        .filter((c) => c.pnl > 0)
        .sort((a, b) => b.pnl - a.pnl)
        .slice(0, 3),
      losers: tracked
        .filter((c) => c.pnl < 0)
        .sort((a, b) => a.pnl - b.pnl)
        .slice(0, 3),
    };
  }, [tracked]);

  // Hide the whole panel if no cards have a cost basis yet
  if (tracked.length === 0) return null;

  return (
    <div style={st.performersStandalone}>
      <div style={st.insightsHeader}>
        <p style={st.insightsEyebrow}>Performers</p>
        <span style={st.analyticsAccent}>◆</span>
      </div>
      <div style={st.perfGrid}>
        <PerformerColumn title="Top Gainers" cards={gainers} positive onSelectCard={onSelectCard} emptyMessage="No gainers yet" />
        <PerformerColumn title="Top Losers"  cards={losers}  positive={false} onSelectCard={onSelectCard} emptyMessage="No losses yet" />
      </div>
    </div>
  );
}

function PerformerColumnImpl({ title, cards, positive, emptyMessage, onSelectCard }) {
  const color = positive ? "#10b981" : "#f87171";
  return (
    <div>
      <div style={{ ...st.perfHeading, color }}>{title}</div>
      {cards.length === 0 ? (
        <div style={st.perfEmpty}>{emptyMessage}</div>
      ) : (
        <div style={st.perfList}>
          {cards.map((c) => (
            <PerformerRow
              key={c.id}
              card={c}
              color={color}
              onSelectCard={onSelectCard}
            />
          ))}
        </div>
      )}
    </div>
  );
}
const PerformerColumn = memo(PerformerColumnImpl);

// Single performer row — extracted + memoized so changes elsewhere on the
// dashboard (modal toggle, pulse, etc.) don't re-render every row.
// Inline click/keydown closures live inside the row body, where they're
// only created when the row itself re-renders.
function PerformerRowImpl({ card, color, onSelectCard }) {
  const tier = getRarityTier(card);
  const clickable = !!onSelectCard;
  return (
    <div
      style={{ ...st.perfItem, ...(clickable ? st.perfItemClickable : {}) }}
      onClick={clickable ? () => onSelectCard(card) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectCard(card);
        }
      } : undefined}
    >
      <div style={st.perfItemMain}>
        <div style={st.perfItemName}>
          {card.playerName ?? "Unknown"}
          {tier && <TierFlag tier={tier} />}
        </div>
        <div style={st.perfItemMeta}>PSA {card.grade}{card.year ? ` · ${card.year}` : ""}</div>
      </div>
      <div style={st.perfItemNumbers}>
        <div style={{ ...st.perfItemPnl, color }}>
          {card.pnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(card.pnl))}
        </div>
        <div style={st.perfItemBasis}>
          {fmtUsd(card.myCost)} → {fmtUsd(card.estimatedValue)}
        </div>
      </div>
    </div>
  );
}
const PerformerRow = memo(PerformerRowImpl);

// ─── Price history line chart ─────────────────────────────────────────
// API shape (from /portfolio/history): [{ timestamp, totalValue, totalCost,
// cardCount }]. We map to {ts, value, cost} for the chart axes. Cost line
// only draws when at least one snapshot has non-null cost (older snapshots
// predate the total_cost migration). Filters out value=0 rows so empty-
// portfolio early snapshots don't squash the Y-axis range.
//
// Chart uses a PLAIN LineChart with fixed pixel dimensions (no
// ResponsiveContainer). ResponsiveContainer was returning width(-1)
// height(-1) inside the dashboard's flex/grid layout — symptom of its
// parent-measurement falling through. Fixed width + overflow:hidden on
// the wrapper trades a touch of small-screen clipping for guaranteed
// rendering across all containers.
function PriceHistoryChart({ history }) {
  if (!history || history.length === 0) {
    return (
      <section style={st.historyPanel}>
        <div style={st.insightsHeader}>
          <p style={st.insightsEyebrow}>Portfolio History</p>
          <span style={st.analyticsAccent}>◆</span>
        </div>
        <div style={st.historyEmpty}>
          Tracking begins after your first snapshot — visit the dashboard
          a couple of times over a few hours and your portfolio history
          will start filling in here automatically.
        </div>
      </section>
    );
  }

  const { chartData, hasCostData, totalReturn, returnPct, positive, returnColor, bestDay } = useMemo(() => {
    const data = history
      .map((h) => ({
        ts:    new Date(h.timestamp).getTime(),
        value: h.totalValue,
        cost:  h.totalCost ?? null,
        label: new Date(h.timestamp).toLocaleString(),
      }))
      .filter((d) => d.value != null && d.value > 0);
    const hasCost = data.some((d) => d.cost != null);
    const lastRow = data[data.length - 1];
    const tr      = lastRow?.cost != null ? lastRow.value - lastRow.cost : null;
    const pct     = lastRow?.cost > 0 ? (tr / lastRow.cost) * 100 : null;
    const pos     = tr != null && tr >= 0;
    const color   = tr == null ? "#94a3b8" : (pos ? "#10b981" : "#f87171");
    let delta = 0;
    let ts    = null;
    for (let i = 1; i < data.length; i++) {
      const diff = data[i].value - data[i - 1].value;
      if (diff > delta) { delta = diff; ts = data[i].ts; }
    }
    return {
      chartData:   data,
      hasCostData: hasCost,
      totalReturn: tr,
      returnPct:   pct,
      positive:    pos,
      returnColor: color,
      bestDay:     delta > 0 ? { delta, ts } : null,
    };
  }, [history]);

  return (
    <section style={st.historyPanel}>
      <div style={st.historyHeader}>
        <div>
          <p style={st.insightsEyebrow}>Portfolio History</p>
          <p style={st.analyticsSub}>{history.length} snapshots tracked</p>
        </div>
        <div style={st.historyLegend}>
          <span style={st.historyLegendItem}>
            <span style={{ ...st.historyLegendSwatch, background: "#f59e0b" }} />
            Portfolio Value
          </span>
          {hasCostData && (
            <span style={st.historyLegendItem}>
              <span style={{ ...st.historyLegendSwatch, background: "#3b82f6" }} />
              Cost Basis
            </span>
          )}
        </div>
      </div>

      <div style={st.historySummary}>
        <div style={st.historySummaryItem}>
          <div style={st.historySummaryLabel}>Total Return</div>
          <div style={{ ...st.historySummaryValue, color: returnColor }}>
            {totalReturn == null
              ? "—"
              : `${positive ? "+" : "−"}${fmtUsd(Math.abs(totalReturn))}`}
          </div>
        </div>
        <div style={st.historySummaryItem}>
          <div style={st.historySummaryLabel}>Return %</div>
          <div style={{ ...st.historySummaryValue, color: returnColor }}>
            {returnPct == null
              ? "—"
              : `${positive ? "+" : "−"}${Math.abs(returnPct).toFixed(2)}%`}
          </div>
        </div>
        <div style={st.historySummaryItem}>
          <div style={st.historySummaryLabel}>Best Day</div>
          <div style={{ ...st.historySummaryValue, color: bestDay ? "#10b981" : "#94a3b8" }}>
            {bestDay ? `+${fmtUsd(bestDay.delta)}` : "—"}
          </div>
          {bestDay && (
            <div style={st.historySummarySub}>
              {new Date(bestDay.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </div>
          )}
        </div>
      </div>

      {/* Plain LineChart, fixed width — no ResponsiveContainer. overflow:
          hidden clips on screens narrower than 600px. */}
      <div style={{ width: "100%", height: 280, minHeight: 280, overflow: "hidden" }}>
        <LineChart width={600} height={280} data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            tick={{ fill: "#64748b", fontSize: 11 }}
            stroke="rgba(255,255,255,0.08)"
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
            tick={{ fill: "#64748b", fontSize: 11 }}
            stroke="rgba(255,255,255,0.08)"
            width={68}
          />
          <Tooltip content={<HistoryTooltip />} cursor={{ stroke: "rgba(245,158,11,0.4)", strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="value"
            name="Portfolio Value"
            stroke="#f59e0b"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          {hasCostData && (
            <Line
              type="monotone"
              dataKey="cost"
              name="Cost Basis"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </div>
    </section>
  );
}

function HistoryTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const gap = p.cost != null ? p.value - p.cost : null;
  const positive = gap != null && gap >= 0;
  return (
    <div style={st.tooltip}>
      <div style={st.tooltipName}>{new Date(p.ts).toLocaleString()}</div>
      <div style={{ ...st.tooltipValue, color: "#f59e0b" }}>
        Value: {fmtUsd(p.value)}
      </div>
      {p.cost != null && (
        <>
          <div style={{ ...st.tooltipValue, color: "#60a5fa", fontSize: "0.95rem" }}>
            Cost: {fmtUsd(p.cost)}
          </div>
          <div style={{ ...st.tooltipPct, color: positive ? "#10b981" : "#f87171" }}>
            {positive ? "+" : "−"}{fmtUsd(Math.abs(gap))} unrealized
          </div>
        </>
      )}
    </div>
  );
}

// ─── Milestones ───────────────────────────────────────────────────────
const MILESTONE_DEFS = {
  value: [1000, 5000, 10000, 25000, 50000, 100000],
  cards: [10, 25, 50, 100],
  rare:  [1, 5, 10, 25], // any tier (ghost / ultra rare / rare)
  ghost: [1, 3],         // ghost-tier specifically — top-pop ≤ 5
};
function computeMilestones(totalValue, cardCount, rareCount, ghostCount) {
  const out = [];
  for (const v of MILESTONE_DEFS.value) {
    if ((totalValue ?? 0) >= v) {
      out.push({ id: `value-${v}`, kind: "value", label: `$${(v / 1000).toFixed(0)}k Value` });
    }
  }
  for (const n of MILESTONE_DEFS.cards) {
    if (cardCount >= n) out.push({ id: `cards-${n}`, kind: "cards", label: `${n} Cards` });
  }
  for (const n of MILESTONE_DEFS.rare) {
    if (rareCount >= n) {
      out.push({ id: `rare-${n}`, kind: "rare", label: `${n} Rare` });
    }
  }
  for (const n of MILESTONE_DEFS.ghost) {
    if (ghostCount >= n) {
      out.push({ id: `ghost-${n}`, kind: "ghost", label: `${n} Ghost` });
    }
  }
  return out;
}

function MilestoneToast({ milestone, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={st.toastWrap} onClick={onDismiss}>
      <div style={st.toast}>
        <span style={st.toastBurst}>✦</span>
        <div>
          <div style={st.toastTitle}>Milestone Achieved</div>
          <div style={st.toastBody}>{milestone.label}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const st = {
  // Full-bleed dark wrapper — breaks out of the protected route's container.
  // overflow-x: hidden defends against any deeply-nested element (charts,
  // grids, animated cards) that might extend past viewport on narrow screens.
  page: {
    overflowX: "hidden",
    background: gradients.pageDark,
    minHeight: "calc(100vh - 60px)",
    // Break out of the parent <main className="container"> 1rem padding
    // without relying on 100vw — desktop browsers that include the
    // scrollbar in 100vw produce a more-negative margin than the
    // container's padding, pushing the page past the right edge of the
    // viewport (the source of the right-side whitespace on mobile sims).
    // -1rem exactly cancels .container's horizontal padding.
    marginLeft: "-1rem",
    marginRight: "-1rem",
    maxWidth: "calc(100% + 2rem)",
    boxSizing: "border-box",
    marginTop: "-2rem",
    marginBottom: "-2rem",
    padding: "3.5rem 0 5rem",
    color: "#e2e8f0",
  },
  inner: {},

  // ─── Tabs ───
  tabBar: {
    display: "flex", alignItems: "center", gap: "0.25rem",
    marginBottom: "2.25rem",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  tab: {
    background: "transparent",
    border: "none",
    color: "#64748b",
    fontSize: "0.92rem", fontWeight: 600,
    padding: "0.85rem 1.25rem",
    cursor: "pointer",
    letterSpacing: "0.01em",
    position: "relative",
    display: "flex", alignItems: "center", gap: "0.5rem",
    transition: "color 0.15s",
    // Faux underline that toggles on active — uses border for crisp 1-pixel
    borderBottom: "2px solid transparent",
    marginBottom: "-1px", // overlap the parent's 1px bottom border
  },
  tabHover: { color: "#cbd5e1" },
  tabActive: {
    color: "#f59e0b",
    borderBottom: "2px solid #f59e0b",
    textShadow: "0 0 24px rgba(245,158,11,0.4)",
  },
  tabBadge: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 22, height: 22,
    padding: "0 0.45rem",
    background: "rgba(255,255,255,0.06)",
    color: "#94a3b8",
    fontSize: "0.7rem", fontWeight: 800,
    borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
    transition: "background 0.15s, color 0.15s",
  },
  tabBadgeActive: {
    background: "rgba(245,158,11,0.18)",
    color: "#fbbf24",
  },

  // ─── Collection / Past header bar (above the grid) ───
  cardsBar: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "1rem",
    flexWrap: "wrap",
    marginBottom: "1.75rem",
    padding: "1.25rem 1.5rem",
    background: gradients.goldPanelSimple,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 14,
  },
  cardsBarLabel: {
    display: "flex", alignItems: "center", gap: "0.55rem",
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#94a3b8", margin: 0,
  },
  cardsBarSub: {
    color: "#64748b", fontSize: "0.85rem",
    margin: "0.4rem 0 0",
  },
  cardsAddBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.5rem",
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    color: "#0f172a",
    fontWeight: 800, fontSize: "0.92rem",
    padding: "0.75rem 1.5rem",
    borderRadius: 999,
    textDecoration: "none",
    letterSpacing: "0.01em",
    boxShadow: "0 6px 20px rgba(245,158,11,0.25), 0 0 0 1px rgba(245,158,11,0.4)",
    transition: "transform 0.1s",
  },
  cardsAddMark: { fontSize: "1.1rem", fontWeight: 700 },

  // ─── Toolbar (sort/filter/view) ───
  toolbar: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    flexWrap: "wrap",
    marginBottom: "1.25rem",
  },
  toolbarSpacer: { flex: 1, minWidth: 0 },
  toolbarCount: {
    fontSize: "0.72rem", fontWeight: 600,
    letterSpacing: "0.12em", textTransform: "uppercase",
    color: "#64748b",
    fontVariantNumeric: "tabular-nums",
  },

  // Native <select> styled as a dark pill with a custom gold-aware chevron.
  // Inline SVG data URI keeps everything self-contained; #94a3b8 = slate-400.
  select: {
    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#e2e8f0",
    fontSize: "0.82rem", fontWeight: 600,
    padding: "0.5rem 2.25rem 0.5rem 0.95rem",
    borderRadius: 999,
    cursor: "pointer",
    outline: "none",
    transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
    backgroundImage:
      "url(\"data:image/svg+xml;charset=UTF-8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 0.75rem center",
    backgroundSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
  selectFocused: {
    borderColor: "rgba(245,158,11,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
  },
  // Native <option>s ignore most CSS in most browsers — set bg/color anyway
  // so Firefox renders a sensible dropdown.
  selectOption: { background: "#0f172a", color: "#e2e8f0" },

  togglePill: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#94a3b8",
    fontSize: "0.78rem", fontWeight: 600,
    padding: "0.4rem 0.95rem",
    borderRadius: 999,
    cursor: "pointer",
    letterSpacing: "0.01em",
    transition: "border-color 0.2s, background 0.2s, color 0.2s",
  },
  togglePillActive: {
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.55)",
    color: "#fbbf24",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.15), 0 0 16px rgba(245,158,11,0.12)",
  },
  toggleDot: {
    width: 6, height: 6, borderRadius: "50%",
    background: "#f59e0b",
  },

  viewToggle: {
    display: "inline-flex",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: 3,
  },
  viewBtn: {
    background: "transparent",
    border: "none",
    color: "#64748b",
    width: 32, height: 28,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    borderRadius: 999,
    transition: "background 0.15s, color 0.15s",
  },
  viewBtnActive: {
    background: "rgba(245,158,11,0.18)",
    color: "#f59e0b",
  },

  // ─── No-matches state ───
  noMatches: {
    textAlign: "center", padding: "3.5rem 1rem",
    background: "rgba(255,255,255,0.02)",
    border: "1px dashed rgba(255,255,255,0.08)",
    borderRadius: 14,
    color: "#64748b",
  },
  noMatchesIcon: {
    fontSize: "1.8rem", color: "#475569",
    marginBottom: "0.85rem",
  },
  noMatchesTitle: {
    fontSize: "0.95rem", fontWeight: 600, color: "#cbd5e1",
    marginBottom: "1rem",
  },
  noMatchesBtn: {
    background: "transparent",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#fbbf24",
    fontSize: "0.78rem", fontWeight: 700,
    padding: "0.45rem 1.15rem", borderRadius: 999,
    cursor: "pointer", letterSpacing: "0.01em",
  },

  // ─── List view ───
  // Outer wrapper provides horizontal scroll for narrow viewports without
  // breaking the column alignment.
  listOuter: { width: "100%", overflowX: "auto", paddingBottom: "0.25rem" },
  list: {
    minWidth: 880,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 14,
    overflow: "hidden",
    background: "rgba(15,23,42,0.4)",
  },
  listHeader: {
    display: "grid",
    gridTemplateColumns: "56px minmax(180px, 1.6fr) 64px 110px 86px 100px 100px 110px 76px",
    alignItems: "center",
    gap: "0.85rem",
    padding: "0.65rem 1rem",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b",
    background: "rgba(15,23,42,0.6)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  listHeadCell: {},
  listRow: {
    display: "grid",
    gridTemplateColumns: "56px minmax(180px, 1.6fr) 64px 110px 86px 100px 100px 110px 76px",
    alignItems: "center",
    gap: "0.85rem",
    padding: "0.7rem 1rem",
    cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    transition: "background 0.15s, box-shadow 0.15s",
  },
  listRowHovered: {
    background: "rgba(245,158,11,0.045)",
    boxShadow: "inset 3px 0 0 rgba(245,158,11,0.7)",
  },
  listRowHighlight: {
    animation: "goldPulse 1.5s ease-in-out 3",
    background: "rgba(245,158,11,0.06)",
  },

  listThumbWrap: {
    width: 40, height: 56,
    borderRadius: 4, overflow: "hidden",
    background: "#06090f",
    flexShrink: 0,
  },
  listThumb: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  listThumbEmpty: {
    width: "100%", height: "100%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "1.1rem", opacity: 0.4,
  },

  listNameCell: { minWidth: 0 },
  listNameTop: { display: "flex", alignItems: "center", gap: "0.4rem" },
  listNameMain: {
    fontSize: "0.92rem", fontWeight: 600, color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listNameMeta: {
    fontSize: "0.7rem", color: "#64748b",
    marginTop: "0.2rem",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listFlagTarget: {
    flexShrink: 0,
    fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.1em",
    color: "#fbbf24",
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.5)",
    padding: "0.05rem 0.3rem", borderRadius: 3,
  },
  // Green SOLD flag for the list-row name column. Lives next to TARGET so
  // they share visual language (small caps, square badge) but a different
  // colour family so the meaning is immediately readable.
  listFlagSold: {
    flexShrink: 0,
    fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.1em",
    color: "#6ee7b7",
    background: "rgba(16,185,129,0.18)",
    border: "1px solid rgba(16,185,129,0.55)",
    padding: "0.05rem 0.3rem", borderRadius: 3,
  },
  // Blue TRADED flag — same envelope as SOLD/TARGET but sky-blue so
  // "left the portfolio via trade" reads distinct from "sold for cash".
  listFlagTraded: {
    flexShrink: 0,
    fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.1em",
    color: "#93c5fd",
    background: "rgba(59,130,246,0.18)",
    border: "1px solid rgba(59,130,246,0.55)",
    padding: "0.05rem 0.3rem", borderRadius: 3,
  },
  listCell: {
    fontSize: "0.82rem", color: "#cbd5e1",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listMoney: { fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" },
  listGradeBadge: {
    display: "inline-flex", alignItems: "center",
    fontSize: "0.7rem", fontWeight: 800,
    color: "#f59e0b",
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(245,158,11,0.4)",
    padding: "0.2rem 0.5rem",
    borderRadius: 4,
    letterSpacing: "0.04em",
  },

  listActions: {
    display: "flex", justifyContent: "flex-end", gap: "0.35rem",
  },
  listActionEdit: {
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#f59e0b",
    width: 28, height: 28, fontSize: "0.78rem", fontWeight: 700,
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  listActionDel: {
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#cbd5e1",
    width: 28, height: 28, fontSize: "0.7rem",
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },

  stateMsg: {
    color: "#64748b",
    fontSize: "0.9rem",
    textAlign: "center",
    padding: "4rem 0",
  },

  // ── Hero stats ──
  hero: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "2rem 2.25rem 1.75rem",
    marginBottom: "2.5rem",
    position: "relative",
    overflow: "hidden",
  },
  heroTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" },
  heroLabel: { display: "flex", alignItems: "center", gap: "0.55rem" },
  heroDot: {
    width: 8, height: 8, borderRadius: "50%",
    background: "#10b981",
    animation: "livePulse 2.4s ease-in-out infinite",
  },
  heroLabelText: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#94a3b8",
  },
  heroAccent: { color: "#f59e0b", fontSize: "1rem", opacity: 0.6 },

  heroValue: {
    fontSize: "clamp(2.4rem, 6vw, 4.2rem)",
    fontWeight: 800,
    color: "#f59e0b",
    letterSpacing: "-0.03em",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    textShadow: "0 0 40px rgba(245,158,11,0.15)",
  },
  heroSubLabel: {
    fontSize: "0.72rem", fontWeight: 600,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#64748b",
    marginTop: "0.65rem",
  },

  // ── P&L hero block (the most prominent stat when cost is set) ──
  heroPnlBlock: { /* container for the P&L value + meta */ },
  heroPnlValue: {
    fontSize: "clamp(2.8rem, 7vw, 5rem)",
    fontWeight: 800,
    letterSpacing: "-0.03em",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    // Soft glow that picks up the green/red colour applied inline
    textShadow: "0 0 40px currentColor",
    filter: "saturate(0.85)",
  },
  heroPnlMeta: {
    display: "flex", alignItems: "baseline", gap: "0.85rem",
    marginTop: "0.85rem",
  },
  heroPnlPct: {
    fontSize: "1.5rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  heroPnlLabel: {
    fontSize: "0.72rem", fontWeight: 600,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#64748b",
  },
  statsRow4: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "1rem",
  },
  // ── Realized + unrealized split (under the headline P&L) ──
  heroSplitRow: {
    display: "flex", gap: "1.25rem",
    marginTop: "0.85rem",
    flexWrap: "wrap",
  },
  heroSplitItem: {
    display: "flex", alignItems: "baseline", gap: "0.5rem",
  },
  heroSplitLabel: {
    color: "#64748b",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  heroSplitValue: {
    fontSize: "1rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  heroDivider: {
    height: 1,
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
    margin: "1.5rem 0 1.25rem",
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "1rem",
  },
  stat: {},
  statValue: {
    fontSize: "1.4rem", fontWeight: 700,
    color: "#f1f5f9", lineHeight: 1.1,
    letterSpacing: "-0.01em",
    fontVariantNumeric: "tabular-nums",
  },
  statValueAccent: { color: "#f59e0b" },
  statLabel: {
    fontSize: "0.66rem", fontWeight: 600,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b", marginTop: "0.3rem",
  },

  // ── Analytics panel ──
  analytics: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "1.75rem 2.25rem 2rem",
    marginBottom: "2.5rem",
  },
  analyticsHeader: {
    display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", gap: "1rem",
    marginBottom: "0.5rem",
  },
  analyticsEyebrow: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#94a3b8", margin: 0,
  },
  analyticsSub: {
    fontSize: "0.78rem", color: "#64748b",
    margin: "0.25rem 0 0", letterSpacing: "0.02em",
  },
  analyticsAccent: { color: "#f59e0b", fontSize: "1rem", opacity: 0.6 },

  analyticsBody: {
    display: "flex", flexWrap: "wrap",
    gap: "2.5rem", alignItems: "center",
    marginTop: "1.25rem",
  },

  // ── Donut chart ──
  chartWrap: {
    position: "relative",
    flex: "0 0 280px",
    minWidth: 240, height: 260,
  },
  donutCenter: {
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    pointerEvents: "none",
  },
  donutCenterLabel: {
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#64748b",
  },
  donutCenterValue: {
    fontSize: "1.15rem", fontWeight: 800,
    color: "#f59e0b", marginTop: "0.3rem",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },

  // ── Legend ──
  legend: {
    flex: 1, minWidth: 240,
    display: "flex", flexDirection: "column",
    gap: "0.25rem",
  },
  legendRow: {
    display: "grid",
    gridTemplateColumns: "16px 1fr auto auto",
    alignItems: "center",
    gap: "0.85rem",
    padding: "0.7rem 0.85rem",
    borderRadius: 8,
    transition: "background 0.15s, opacity 0.15s",
    cursor: "default",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  legendRowActive: {
    background: "rgba(245,158,11,0.06)",
  },
  legendDot: {
    width: 10, height: 10, borderRadius: "50%",
    boxShadow: "0 0 0 3px rgba(0,0,0,0.3)",
  },
  legendName: {
    fontSize: "0.88rem", color: "#e2e8f0", fontWeight: 500,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  legendValue: {
    fontSize: "0.88rem", color: "#f1f5f9", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  legendPct: {
    fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    minWidth: 50, textAlign: "right",
  },

  // ── Tooltip ──
  tooltip: {
    background: "rgba(15,23,42,0.96)",
    border: "1px solid rgba(245,158,11,0.4)",
    borderRadius: 8,
    padding: "0.7rem 0.95rem",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    backdropFilter: "blur(8px)",
  },
  tooltipName: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    color: "#94a3b8", marginBottom: "0.4rem",
  },
  tooltipValue: {
    fontSize: "1.1rem", fontWeight: 800,
    color: "#f59e0b",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  tooltipPct: {
    fontSize: "0.72rem", color: "#cbd5e1",
    marginTop: "0.2rem",
  },

  // ── Grid ──
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "1.5rem",
  },

  // ── Tile ──
  tile: {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 14,
    overflow: "hidden",
    cursor: "pointer",
    transition: "transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease",
    animation: "fadeInUp 0.5s ease-out backwards",
    position: "relative",
  },

  // ── Skeleton loading tile ──
  // Same shell as a real tile minus interaction. Shimmer driven by the
  // `skeletonShimmer` keyframe in index.css; the wide gradient + 200%
  // background-size gives the highlight band room to sweep.
  skeletonTile: {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  skeletonImage: {
    width: "100%",
    aspectRatio: "5 / 7",
    background: "linear-gradient(110deg, rgba(255,255,255,0.025) 30%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.025) 70%)",
    backgroundSize: "200% 100%",
    animation: "skeletonShimmer 1.4s ease-in-out infinite",
  },
  skeletonBody: {
    padding: "0.95rem 0.95rem 1.05rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.55rem",
  },
  skeletonLine: {
    height: "0.7rem",
    borderRadius: 4,
    background: "linear-gradient(110deg, rgba(255,255,255,0.025) 30%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.025) 70%)",
    backgroundSize: "200% 100%",
    animation: "skeletonShimmer 1.4s ease-in-out infinite",
    width: "100%",
  },

  // ── Dashboard skeleton ──
  skeletonAnalyticsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
    marginTop: "1.5rem",
  },
  skeletonPanel: {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  skeletonChartArea: {
    width: "100%",
    height: 180,
    borderRadius: 8,
    background: "linear-gradient(110deg, rgba(255,255,255,0.025) 30%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.025) 70%)",
    backgroundSize: "200% 100%",
    animation: "skeletonShimmer 1.4s ease-in-out infinite",
  },
  tileHovered: {
    transform: "translateY(-3px)",
    borderColor: "rgba(245,158,11,0.45)",
    background: "#111c33",
    boxShadow:
      "0 0 0 1px rgba(245,158,11,0.15), 0 12px 28px rgba(0,0,0,0.5), 0 0 32px rgba(245,158,11,0.12)",
  },
  tileHighlight: {
    // Triggered when the tile is the target of a deep-link highlight.
    // Three pulses (1.5s × 3) then style is removed by the timeout in CardTile.
    animation: "fadeInUp 0.5s ease-out backwards, goldPulse 1.5s ease-in-out 3",
    borderColor: "rgba(245,158,11,0.75)",
  },
  tileTradePulse: {
    // Triggered for cards just received in a trade. Two pulses × 1.5s = 3s,
    // matching the spec. Same gold visual as tileHighlight but no scroll.
    animation: "scp-trade-card-pulse 1.5s ease-in-out 2",
    borderColor: "rgba(245,158,11,0.75)",
  },

  // ── Image ──
  imageWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "5 / 7", // standard trading card ratio
    background: "#06090f",
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  imageGradient: {
    position: "absolute", inset: 0,
    background: "linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.35) 100%)",
    pointerEvents: "none",
  },
  imageFallback: {
    width: "100%", height: "100%",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: "0.5rem", color: "#334155",
  },
  imageFallbackIcon: { fontSize: "2.5rem", opacity: 0.5 },
  imageFallbackText: { fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" },

  tileActions: {
    position: "absolute", top: 10, right: 10,
    display: "flex", gap: "0.4rem",
    transition: "opacity 0.15s",
    zIndex: 2,
  },
  editBtn: {
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#f59e0b",
    borderRadius: "50%",
    width: 28, height: 28, fontSize: "0.78rem",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(8px)",
    fontWeight: 700,
  },
  deleteBtn: {
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#cbd5e1",
    borderRadius: "50%",
    width: 28, height: 28, fontSize: "0.7rem",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(8px)",
  },

  gradeBadge: {
    position: "absolute", bottom: 10, left: 10,
    display: "flex", alignItems: "center", gap: "0.35rem",
    background: "rgba(15,23,42,0.88)",
    border: "1px solid rgba(245,158,11,0.4)",
    borderRadius: 4,
    padding: "2px 0.5rem 2px 2px",
    backdropFilter: "blur(8px)",
    pointerEvents: "none",
    zIndex: 2,
  },
  // White-stickered PSA logo. White bg shows through the AVIF's transparent
  // areas so the dark PSA marks stay legible on the dark tile background.
  gradeBadgeLogo: {
    height: 20,
    width: "auto",
    display: "block",
    background: "#fff",
    padding: "1px 3px",
    borderRadius: 2,
  },
  gradeBadgeValue: {
    fontSize: "0.85rem", fontWeight: 800,
    color: "#f59e0b", lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  // Text fallback used in place of /psa.avif for BGS / SGC. Same
  // height + white-pill envelope so the badge visual balance stays
  // identical regardless of grader.
  gradeBadgeText: {
    height: 20,
    display: "flex", alignItems: "center",
    background: "#fff",
    color: "#0f172a",
    padding: "0 5px",
    borderRadius: 2,
    fontSize: "0.65rem", fontWeight: 900,
    letterSpacing: "0.04em",
    fontFamily: "inherit",
  },

  // ─── Tier ribbon (top-left of grid tile) ───
  tierRibbonBase: {
    position: "absolute", top: 10, left: 10,
    fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.12em",
    padding: "0.25rem 0.5rem", borderRadius: 3,
    zIndex: 2,
  },
  tierRibbonUltraRare: {
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#0f172a",
    boxShadow: "0 2px 10px rgba(245,158,11,0.4)",
  },
  tierRibbonRare: {
    background: "linear-gradient(135deg, rgba(147,197,253,0.18), rgba(99,102,241,0.12))",
    color: "#bfdbfe",
    border: "1px solid rgba(147,197,253,0.6)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 2px 12px rgba(147,197,253,0.25)",
  },
  // Ghost wraps the icon component directly — no pill. The icon itself
  // carries the float+sway animation and a built-in glow. zIndex 4 keeps it
  // above the target-reached badge (3), grade badge (default), and image.
  // Lives in the bottom-right opposite the bottom-left grade badge; opacity
  // 0.85 keeps it visible while letting the card image still read through.
  ghostBadgeTile: {
    position: "absolute", bottom: 8, right: 8,
    opacity: 0.85,
    zIndex: 4,
  },
  ghostBadgeInline: {
    display: "inline-flex", alignItems: "center",
    flexShrink: 0,
  },

  // ─── Tier flag (small inline label) ───
  tierFlagBase: {
    flexShrink: 0,
    display: "inline-block",
    fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.1em",
    padding: "0.1rem 0.35rem", borderRadius: 3,
    lineHeight: 1.4,
  },
  tierFlagUltraRare: {
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#0f172a",
  },
  tierFlagRare: {
    background: "rgba(147,197,253,0.12)",
    color: "#bfdbfe",
    border: "1px solid rgba(147,197,253,0.55)",
  },

  // ── Info bar ──
  infoBar: {
    padding: "0.85rem 1rem",
    borderTop: "1px solid rgba(255,255,255,0.04)",
    background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.15))",
  },
  infoTopRow: {
    display: "flex", alignItems: "baseline",
    justifyContent: "space-between", gap: "0.5rem",
    marginBottom: "0.4rem",
  },
  playerName: {
    fontSize: "0.88rem", fontWeight: 600, color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    flex: 1, minWidth: 0,
  },
  metaRight: {
    fontSize: "0.65rem", color: "#64748b",
    letterSpacing: "0.04em",
    flexShrink: 0,
  },
  infoBottomRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "0.5rem",
  },
  costLine: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    fontSize: "0.7rem",
    color: "#64748b",
    marginTop: "0.4rem",
    paddingTop: "0.4rem",
    borderTop: "1px solid rgba(255,255,255,0.04)",
    fontVariantNumeric: "tabular-nums",
  },
  costLineLabel: {
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    color: "#475569",
  },
  costLineValue: { color: "#cbd5e1", fontWeight: 600 },
  costLinePnl: { marginLeft: "auto", fontWeight: 700 },

  // ── Price button (in-tile) ──
  priceBtn: {
    background: "none", border: "none", padding: 0,
    fontSize: "1.1rem", fontWeight: 700,
    color: "#f59e0b", cursor: "pointer",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
    transition: "opacity 0.15s",
  },
  priceBtnEmpty: {
    background: "none", border: "1px dashed rgba(245,158,11,0.4)",
    padding: "0.2rem 0.55rem", borderRadius: 4,
    fontSize: "0.72rem", fontWeight: 600,
    color: "#94a3b8", cursor: "pointer",
    letterSpacing: "0.04em",
  },
  // Realized sale price — same visual weight as priceBtn, green not gold,
  // and not a button (sold cards aren't editable).
  priceSold: {
    fontSize: "1.1rem", fontWeight: 700,
    color: "#6ee7b7",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
    cursor: "default",
  },
  // Diagonal SOLD stamp on the card image — bold green pill that reads
  // "this card has left the portfolio (and made you money)".
  soldStamp: {
    position: "absolute",
    top: 12, right: 12,
    fontSize: "0.65rem", fontWeight: 900,
    letterSpacing: "0.18em",
    color: "#0f172a",
    background: "linear-gradient(135deg, #34d399, #10b981)",
    padding: "0.25rem 0.65rem",
    borderRadius: 4,
    boxShadow: "0 4px 14px rgba(16,185,129,0.5), 0 0 0 1px rgba(16,185,129,0.85)",
    transform: "rotate(8deg)",
    zIndex: 4,
  },
  // Sibling of soldStamp — same diagonal placement, blue gradient so the
  // user can spot traded cards at a glance in the grid view.
  tradedStamp: {
    position: "absolute",
    top: 12, right: 12,
    fontSize: "0.65rem", fontWeight: 900,
    letterSpacing: "0.18em",
    color: "#0f172a",
    background: "linear-gradient(135deg, #60a5fa, #3b82f6)",
    padding: "0.25rem 0.65rem",
    borderRadius: 4,
    boxShadow: "0 4px 14px rgba(59,130,246,0.5), 0 0 0 1px rgba(59,130,246,0.85)",
    transform: "rotate(8deg)",
    zIndex: 4,
  },

  // ── Inline editor ──
  editBlock: {
    display: "flex", alignItems: "center", gap: "0.25rem",
    background: "rgba(245,158,11,0.08)",
    border: "1px solid rgba(245,158,11,0.4)",
    borderRadius: 6, padding: "0.15rem 0.35rem",
  },
  editDollar: { fontSize: "0.85rem", color: "#f59e0b", fontWeight: 700 },
  editInput: {
    width: 70, background: "transparent", border: "none", outline: "none",
    fontSize: "0.9rem", fontWeight: 700, color: "#f1f5f9",
    fontVariantNumeric: "tabular-nums",
  },
  editOk: {
    background: "#f59e0b", color: "#0f172a", border: "none",
    borderRadius: 4, width: 22, height: 22, fontSize: "0.7rem",
    cursor: "pointer", fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  editX: {
    background: "transparent", color: "#94a3b8",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4, width: 22, height: 22, fontSize: "0.7rem",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },

  // ── Pop badge ──
  popBadge: {
    fontSize: "0.62rem", color: "#64748b",
    letterSpacing: "0.04em",
    display: "flex", alignItems: "center", gap: "0.3rem",
    flexShrink: 0,
  },
  popBadgeDot: { color: "#334155" },
  popBadgeHigherZero: { color: "#10b981", fontWeight: 700 },

  // ── Empty state ──
  empty: {
    textAlign: "center", padding: "5rem 1rem",
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 16,
  },
  emptyIcon: { fontSize: "2.5rem", color: "#f59e0b", opacity: 0.5, marginBottom: "1rem" },
  emptyTitle: {
    fontSize: "1.4rem", fontWeight: 700, color: "#f1f5f9",
    margin: "0 0 0.5rem", letterSpacing: "-0.02em",
  },
  emptySub: { color: "#64748b", fontSize: "0.92rem" },
  emptyCta: {
    display: "inline-flex", alignItems: "center", gap: "0.45rem",
    marginTop: "1.5rem",
    background: "#f59e0b", color: "#0f172a",
    padding: "0.65rem 1.2rem",
    borderRadius: 8,
    fontSize: "0.9rem", fontWeight: 700,
    letterSpacing: "0.02em",
    textDecoration: "none",
    transition: "background 0.2s, transform 0.1s",
  },
  // Same visual as emptyCta but renders as <button> — used by AllInPastState
  // to switch tabs without a route navigation.
  emptyCtaBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.45rem",
    marginTop: "1.5rem",
    background: "#f59e0b", color: "#0f172a",
    padding: "0.65rem 1.2rem",
    borderRadius: 8,
    fontSize: "0.9rem", fontWeight: 700,
    letterSpacing: "0.02em",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.2s, transform 0.1s",
  },

  // ─── Collection History summary strip ───
  // Three-stat row at the top of the Collection History tab. Hairline
  // dividers between stats; tabular-nums on values so digits don't jitter
  // when the data refreshes after a sale lands.
  pastSummary: {
    display: "flex",
    alignItems: "center",
    gap: "0",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
    margin: "1.25rem 0 1.5rem",
  },
  pastSummaryItem: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.35rem",
    minWidth: 0,
  },
  pastSummaryDivider: {
    alignSelf: "stretch",
    width: 1,
    background: "rgba(255,255,255,0.06)",
    margin: "0 1rem",
  },
  pastSummaryValue: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: "-0.01em",
    fontVariantNumeric: "tabular-nums",
  },
  pastSummaryLabel: {
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#94a3b8",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    textAlign: "center",
  },

  // ─── Edit cost modal ───
  editBackdrop: {
    position: "fixed", inset: 0, zIndex: 1500,
    background: "rgba(5,8,17,0.85)",
    backdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "2rem 1rem",
  },
  editModal: {
    position: "relative",
    width: "100%", maxWidth: 460,
    background: "linear-gradient(160deg, #0f172a 0%, #0a0f1f 100%)",
    border: "1px solid rgba(245,158,11,0.18)",
    borderRadius: 16,
    boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.08), 0 0 80px rgba(245,158,11,0.06)",
    padding: "2rem 2rem 1.5rem",
    color: "#e2e8f0",
  },
  editClose: {
    position: "absolute", top: 14, right: 14,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#94a3b8", borderRadius: "50%",
    width: 30, height: 30, fontSize: "0.78rem",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  editHeader: {},
  editEyebrow: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#f59e0b", margin: "0 0 0.85rem",
  },
  editTitle: {
    fontSize: "1.5rem", fontWeight: 800, color: "#f1f5f9",
    letterSpacing: "-0.02em", margin: 0, lineHeight: 1.2,
  },
  editSub: {
    fontSize: "0.82rem", color: "#94a3b8",
    margin: "0.35rem 0 0", letterSpacing: "0.02em",
  },
  editDivider: {
    height: 1,
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
    margin: "1.5rem 0 1.25rem",
  },
  editFieldLabel: {
    display: "block",
    fontSize: "0.7rem", fontWeight: 600,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b", marginBottom: "0.65rem",
  },
  costInputWrap: {
    display: "flex", alignItems: "center",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "0 1.25rem",
    transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
  },
  costInputWrapFocused: {
    borderColor: "rgba(245,158,11,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
  },
  costDollarLg: {
    color: "#f59e0b", fontSize: "1.4rem", fontWeight: 800,
    marginRight: "0.6rem",
  },
  costInputLg: {
    flex: 1,
    background: "transparent",
    border: "none", outline: "none",
    color: "#f1f5f9",
    fontSize: "1.4rem", fontWeight: 700,
    padding: "0.95rem 0",
    fontVariantNumeric: "tabular-nums",
    MozAppearance: "textfield",
    letterSpacing: "-0.01em",
  },
  editHint: {
    fontSize: "0.72rem", color: "#64748b",
    margin: "0.55rem 0 0", letterSpacing: "0.02em",
  },
  editPreview: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "rgba(255,255,255,0.02)",
    border: "1px solid",
    borderRadius: 8,
    padding: "0.7rem 1rem",
    marginTop: "1rem",
    fontVariantNumeric: "tabular-nums",
  },
  editPreviewLabel: {
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    opacity: 0.85,
  },
  editPreviewValue: {
    fontSize: "1.15rem", fontWeight: 800,
    letterSpacing: "-0.01em",
  },
  editError: {
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.25)",
    color: "#fca5a5",
    fontSize: "0.82rem",
    padding: "0.6rem 0.9rem",
    borderRadius: 6,
    marginTop: "1rem",
  },
  editFooter: {
    display: "flex", justifyContent: "flex-end", gap: "0.75rem",
    marginTop: "1.75rem",
  },
  editCancel: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#94a3b8",
    fontSize: "0.85rem", fontWeight: 600,
    padding: "0.7rem 1.25rem", borderRadius: 8,
    cursor: "pointer",
    letterSpacing: "0.01em",
  },
  editSave: {
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    border: "none",
    color: "#0f172a",
    fontSize: "0.9rem", fontWeight: 800,
    padding: "0.7rem 1.5rem", borderRadius: 8,
    cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 4px 16px rgba(245,158,11,0.25), 0 0 0 1px rgba(245,158,11,0.4)",
  },
  eyebrowMark: { marginRight: "0.4rem" },

  // ─── Alert banner ───
  alertBanner: {
    background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06))",
    border: "1px solid rgba(245,158,11,0.4)",
    borderRadius: 14,
    padding: "1.25rem 1.5rem",
    marginBottom: "2rem",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.1), 0 0 32px rgba(245,158,11,0.08)",
  },
  alertHeader: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    marginBottom: "0.85rem",
  },
  alertDot: {
    width: 10, height: 10, borderRadius: "50%",
    background: "#f59e0b",
    animation: "livePulse 1.6s ease-in-out infinite",
  },
  alertEyebrow: {
    fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#fbbf24",
  },
  alertJump: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#fbbf24",
    fontSize: "0.78rem", fontWeight: 700,
    padding: "0.3rem 0.8rem", borderRadius: 999,
    cursor: "pointer", letterSpacing: "0.01em",
  },
  // ─── Target-reached badge on tile ───
  // Lives in the bottom-left, stacked above the grade badge. The slimmer
  // PSA-logo grade pill is ~26px tall now, so 42px clears it with breathing room.
  targetBadge: {
    position: "absolute", bottom: 42, left: 10,
    display: "flex", alignItems: "center", gap: "0.3rem",
    background: "rgba(15,23,42,0.92)",
    border: "1px solid rgba(245,158,11,0.6)",
    borderRadius: 999,
    padding: "0.25rem 0.55rem",
    fontSize: "0.6rem", fontWeight: 800,
    color: "#fbbf24",
    letterSpacing: "0.12em",
    backdropFilter: "blur(8px)",
    boxShadow: "0 0 12px rgba(245,158,11,0.4)",
    animation: "livePulse 2s ease-in-out infinite",
    zIndex: 3,
  },
  targetBadgeDot: {
    width: 6, height: 6, borderRadius: "50%",
    background: "#f59e0b",
  },

  // ─── Performers panel header (used by the standalone PerformersPanel
  // shell — keeps the same visual treatment we removed from InsightsRow).
  insightsHeader: {
    display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", marginBottom: "1.25rem",
  },
  insightsEyebrow: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#94a3b8", margin: 0,
  },

  // ─── Performers ───
  perfGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1.25rem 1.5rem",
  },
  perfHeading: {
    fontSize: "0.65rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    marginBottom: "0.75rem",
  },
  perfList: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  perfEmpty: {
    fontSize: "0.78rem", color: "#475569",
    fontStyle: "italic", padding: "0.85rem 0",
    letterSpacing: "0.02em",
  },
  // PerformersPanel is no longer wrapped by InsightsRow; this style mirrors
  // the old insightsCol shell so the panel keeps the same visual treatment
  // when rendered standalone on the dashboard.
  performersStandalone: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "1.5rem 1.75rem",
    marginBottom: "2.5rem",
  },
  perfItem: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "0.75rem",
    padding: "0.55rem 0",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  perfItemClickable: {
    cursor: "pointer",
    borderRadius: 6,
    margin: "0 -0.5rem",
    padding: "0.55rem 0.5rem",
    transition: "background 0.15s ease",
  },
  perfItemMain: { flex: 1, minWidth: 0 },
  perfItemName: {
    fontSize: "0.85rem", fontWeight: 600, color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  perfItemMeta: { fontSize: "0.7rem", color: "#64748b", marginTop: "0.1rem" },
  perfItemNumbers: { textAlign: "right", flexShrink: 0 },
  perfItemPnl: {
    fontSize: "0.95rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  perfItemBasis: {
    fontSize: "0.66rem", color: "#475569",
    fontVariantNumeric: "tabular-nums", marginTop: "0.15rem",
  },

  // ─── Price history chart ───
  historyPanel: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "1.75rem 2rem 1rem",
    marginBottom: "2.5rem",
  },
  historyHeader: {
    display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", flexWrap: "wrap",
    gap: "1rem", marginBottom: "1.25rem",
  },
  historyLegend: {
    display: "flex", alignItems: "center", gap: "1.25rem",
    flexWrap: "wrap",
  },
  historyLegendItem: {
    display: "inline-flex", alignItems: "center", gap: "0.45rem",
    fontSize: "0.72rem", fontWeight: 600,
    letterSpacing: "0.08em", textTransform: "uppercase",
    color: "#94a3b8",
  },
  historyLegendSwatch: {
    display: "inline-block",
    width: 10, height: 10, borderRadius: 2,
  },
  historySummary: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "1rem",
    padding: "1rem 1.25rem",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 12,
    marginBottom: "1.25rem",
  },
  historySummaryItem: {
    display: "flex", flexDirection: "column",
    gap: "0.25rem",
  },
  historySummaryLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b",
  },
  historySummaryValue: {
    fontSize: "1.35rem", fontWeight: 800,
    lineHeight: 1, letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
  },
  historySummarySub: {
    fontSize: "0.7rem", color: "#94a3b8",
    fontWeight: 600,
  },
  historyEmpty: {
    color: "#64748b", fontSize: "0.85rem",
    textAlign: "center", padding: "2.5rem 1rem",
    fontStyle: "italic",
  },

  // ─── Milestone toast ───
  toastWrap: {
    position: "fixed", top: 80, right: 24, zIndex: 2000,
    pointerEvents: "auto",
    cursor: "pointer",
  },
  toast: {
    display: "flex", alignItems: "center", gap: "0.85rem",
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    color: "#0f172a",
    padding: "1rem 1.5rem 1rem 1.25rem",
    borderRadius: 12,
    boxShadow: "0 12px 40px rgba(245,158,11,0.4), 0 0 0 1px rgba(245,158,11,0.6), 0 0 60px rgba(245,158,11,0.3)",
    animation: "fadeInUp 0.4s ease-out",
    minWidth: 240,
  },
  toastBurst: {
    fontSize: "1.6rem",
    animation: "pulse 1.6s ease-in-out infinite",
  },
  toastTitle: {
    fontSize: "0.65rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
    opacity: 0.7,
  },
  toastBody: {
    fontSize: "1rem", fontWeight: 800,
    marginTop: "0.15rem",
    letterSpacing: "-0.01em",
  },
};
