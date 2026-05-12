import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lookupPsaCert, previewPricing, executeTrade, confirmTradeCost, cancelTrade, refreshPortfolio, analyzeTrade } from "../services/api.js";
import { isSold, isTraded, effectiveValue, cardPnl } from "../utils/portfolio.js";
import { computeTradeCostBasis } from "../utils/trade.js";
import { gradients } from "../utils/theme.js";

// TradeDesk page — Phase 2 of the trade feature.
//
// State machine:
//   step="building"   → user picks given cards, looks up received cards,
//                       enters cash, clicks Execute Trade
//   step="allocating" → server has executed the trade; user allocates
//                       cost basis across received cards and confirms
//
// Animation between steps is intentionally skipped — Phase 3 will add it.
//
// Cost basis math (per spec):
//   total = Σ(my_cost of given cards) − cashReceived + cashGiven
// That total is what the user allocates across the received cards.

function fmtUsd(n) {
  if (n == null || isNaN(n)) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A card is selectable for trading if the user still owns it and it
// isn't tied up in a sold/listed/traded state. Mirrors the spec: "active
// cards (not sold, listed, or traded)".
function isTradableCard(card) {
  if (isSold(card) || isTraded(card)) return false;
  const cs = card.consignmentStatus;
  if (cs === "pending" || cs === "in_review" || cs === "listed") return false;
  return true;
}

export default function TradeTab({ cards, onTradeComplete, pastTrades, historyLoading, historyError }) {
  const [step, setStep] = useState("building");

  // Building-step state
  const [selectedIds,   setSelectedIds]   = useState(() => new Set());
  const [receivedCards, setReceivedCards] = useState([]);
  const [cashGiven,     setCashGiven]     = useState("");
  const [cashReceived,  setCashReceived]  = useState("");
  // Live filter on the left column. Matches case-insensitively against
  // playerName, year, and brand — any field can match.
  const [searchTerm,    setSearchTerm]    = useState("");
  const [certInput,     setCertInput]     = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError,   setLookupError]   = useState(null);
  const [executeError,  setExecuteError]  = useState(null);
  const [executing,     setExecuting]     = useState(false);
  // Pricing preview per received cert. Shape per entry:
  //   { status: "loading" | "loaded" | "unavailable", avgSalePrice?: number }
  // Populated async after each PSA lookup; the fetch is fire-and-forget
  // and resolves into this map regardless of which order they finish.
  const [pricingByCert, setPricingByCert] = useState({});

  // Allocating-step state
  const [tradeId,         setTradeId]         = useState(null);
  const [persistedReceived, setPersistedReceived] = useState([]); // [{ id, certNumber, ...}]
  const [allocations,     setAllocations]     = useState({});  // certNumber → string (raw input)
  // Animation-step state — tracks the fade-out of the success overlay
  // so we can transition into the allocation screen without a hard cut.
  const [overlayExiting, setOverlayExiting] = useState(false);
  const [confirming,      setConfirming]      = useState(false);
  const [confirmError,    setConfirmError]    = useState(null);
  const [cancelling,      setCancelling]      = useState(false);
  // Confirm-trade modal — gated on a pre-flight click of the gold
  // Confirm Trade button so the user gets a "no undo" warning before
  // /trades/confirm-cost lands.
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // AI trade analysis state. Three flags coordinate the loading→result
  // handoff:
  //   - analyzing: loading modal is shown
  //   - analysisResult: response from the Lambda (null while in flight)
  //   - showResult: result modal is shown (set by loading-modal's
  //     onComplete after it animates to 100% and the celebratory pause)
  // analysisError surfaces directly without opening either modal.
  const [analyzing,      setAnalyzing]      = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showResult,     setShowResult]     = useState(false);
  const [analysisError,  setAnalysisError]  = useState(null);

  // Past Trades data is owned by TradeDeskPage and passed through as a prop
  // tab unmount/remount — visiting the tab no longer re-fires
  // listTrades() each time.

  const tradableCards = useMemo(() => cards.filter(isTradableCard), [cards]);
  const givenCards    = useMemo(
    () => tradableCards.filter((c) => selectedIds.has(c.id)),
    [tradableCards, selectedIds]
  );
  // Cached analysis is invalidated when the trade composition changes —
  // adding or removing cards on either side means the previous verdict
  // no longer reflects what's being traded. Cash amounts and search-bar
  // changes do NOT invalidate (the cached result is still meaningful at
  // a glance, and a re-analysis is one click away). After invalidation
  // the action button reverts to "Analyze Trade" so the user knows a
  // fresh run is needed.
  useEffect(() => {
    setAnalysisResult(null);
  }, [selectedIds, receivedCards]);

  // Filtered view of tradable cards driven by the search input. Empty
  // term passes everything through. Selected cards are kept visible
  // even if they don't match the term so the user can always deselect
  // them without clearing the filter first.
  const filteredTradableCards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return tradableCards;
    return tradableCards.filter((c) => {
      if (selectedIds.has(c.id)) return true;
      const hay = `${c.playerName ?? ""} ${c.year ?? ""} ${c.brand ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [tradableCards, searchTerm, selectedIds]);

  function toggleSelect(cardId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }

  async function handleLookup() {
    const cert = certInput.trim();
    if (!cert) return;
    if (receivedCards.some((r) => r.certNumber === cert)) {
      setLookupError("That cert is already added to this trade.");
      return;
    }
    if (cards.some((c) => c.certNumber === cert)) {
      setLookupError("That cert is already in your portfolio.");
      return;
    }
    setLookupError(null);
    setLookupLoading(true);
    try {
      const psa = await lookupPsaCert(cert);
      setReceivedCards((prev) => [...prev, psa]);
      setCertInput("");
      // Kick off pricing fetch in the background. We don't await — the
      // tile renders immediately with "Fetching value…" and updates
      // when the response lands. Multiple cards added in quick
      // succession run their fetches in parallel.
      setPricingByCert((prev) => ({ ...prev, [psa.certNumber]: { status: "loading" } }));
      previewPricing(psa)
        .then((res) => {
          setPricingByCert((prev) => ({
            ...prev,
            [psa.certNumber]: res?.available
              ? {
                  status: "loaded",
                  avgSalePrice:       res.avgSalePrice,
                  cardhedgerImageUrl: res.cardhedgerImageUrl ?? null,
                }
              : { status: "unavailable" },
          }));
        })
        .catch(() => {
          setPricingByCert((prev) => ({
            ...prev,
            [psa.certNumber]: { status: "unavailable" },
          }));
        });
    } catch (err) {
      setLookupError(err?.message ?? "PSA lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }

  function removeReceived(cert) {
    setReceivedCards((prev) => prev.filter((r) => r.certNumber !== cert));
    setPricingByCert((prev) => {
      const next = { ...prev };
      delete next[cert];
      return next;
    });
  }

  const cashGivenNum    = parseFloat(cashGiven)    || 0;
  const cashReceivedNum = parseFloat(cashReceived) || 0;
  const totalCostBasis  = computeTradeCostBasis(givenCards, cashGivenNum, cashReceivedNum);

  // Side totals for the summary bar. Given side uses each card's
  // estimatedValue (already on the Card payload). Received side uses
  // the previewed avgSalePrice from /pricing/preview, falling back to
  // 0 for cards still loading or with no CardHedger match — the summary
  // bar surfaces that fallback honestly via the fetching/unavailable
  // chips on each tile so the totals aren't misleading.
  const givenValueSum = givenCards.reduce(
    (sum, c) => sum + (effectiveValue(c) ?? 0),
    0
  );
  const receivedValueSum = receivedCards.reduce((sum, r) => {
    const p = pricingByCert[r.certNumber];
    return sum + (p?.status === "loaded" ? p.avgSalePrice : 0);
  }, 0);
  const givenSideTotal    = givenValueSum    + cashGivenNum;
  const receivedSideTotal = receivedValueSum + cashReceivedNum;
  const tradeDifference   = receivedSideTotal - givenSideTotal;
  const anyReceivedLoading = receivedCards.some(
    (r) => pricingByCert[r.certNumber]?.status === "loading"
  );

  const canExecute =
    !executing &&
    givenCards.length + receivedCards.length > 0 &&
    givenCards.length > 0 && receivedCards.length > 0; // spec: at least one on each side

  // Analyze is permissive — even a one-sided trade (e.g. "what would I
  // get if I tried to receive these"?) can yield useful analysis. Just
  // requires at least one card on either side.
  const canAnalyze    = !analyzing && (givenCards.length > 0 || receivedCards.length > 0);
  const hasCachedAnalysis = !!analysisResult && !analyzing;

  async function handleAnalyze() {
    setAnalysisError(null);
    setAnalysisResult(null);
    setShowResult(false);
    setAnalyzing(true);
    try {
      const res = await analyzeTrade({
        cardsGiven:    givenCards.map((c) => c.id),
        cardsReceived: receivedCards.map((r) => {
          const p = pricingByCert[r.certNumber];
          const estimatedValue =
            p?.status === "loaded" && Number.isFinite(p.avgSalePrice) ? p.avgSalePrice : null;
          return {
            certNumber:          r.certNumber,
            playerName:          r.playerName,
            year:                r.year,
            brand:               r.brand,
            sport:               r.sport,
            category:            r.category,
            cardNumber:          r.cardNumber,
            grade:               r.grade,
            gradeDescription:    r.gradeDescription,
            psaPopulation:       r.psaPopulation,
            psaPopulationHigher: r.psaPopulationHigher,
            estimatedValue,
          };
        }),
        cashGiven:    cashGivenNum,
        cashReceived: cashReceivedNum,
      });
      // Don't flip analyzing off here — the loading modal owns the
      // 100% transition + celebratory hold and will call onComplete
      // when it's ready to hand off to the result modal.
      setAnalysisResult(res);
    } catch (err) {
      setAnalysisError(err?.message ?? "Analysis failed");
      setAnalyzing(false);
    }
  }

  function handleAnalysisLoadingComplete() {
    setAnalyzing(false);
    setShowResult(true);
  }

  async function handleExecute() {
    setExecuteError(null);
    setExecuting(true);
    try {
      const res = await executeTrade({
        cardsGiven:    givenCards.map((c) => c.id),
        cardsReceived: receivedCards.map((r) => {
          // Snapshot the trade-time value from the previewPricing result
          // we already showed the user. Falls back to null when pricing
          // is still loading or unavailable — server stores NULL in that
          // case and Past Trades shows "—".
          const p = pricingByCert[r.certNumber];
          const estimatedValue =
            p?.status === "loaded" && Number.isFinite(p.avgSalePrice)
              ? p.avgSalePrice
              : null;
          return {
            certNumber:          r.certNumber,
            playerName:          r.playerName,
            year:                r.year,
            brand:               r.brand,
            grade:               r.grade,
            sport:               r.sport,
            category:            r.category,
            cardNumber:          r.cardNumber,
            gradeDescription:    r.gradeDescription,
            frontImageUrl:       r.frontImageUrl,
            backImageUrl:        r.backImageUrl,
            psaPopulation:       r.psaPopulation,
            psaPopulationHigher: r.psaPopulationHigher,
            psaData:             r.psaData,
            estimatedValue,
          };
        }),
        cashGiven:    cashGivenNum,
        cashReceived: cashReceivedNum,
      });
      setTradeId(res.tradeId);
      // Pair the server's authoritative card_ids back with the metadata
      // we already have so the allocation screen can render rich tiles
      // without re-fetching.
      const idByCert = Object.fromEntries(res.receivedCards.map((c) => [c.certNumber, c.id]));
      setPersistedReceived(receivedCards.map((r) => ({ ...r, id: idByCert[r.certNumber] })));
      // Seed allocations to empty strings so the inputs render controlled
      // and the "Split Evenly" path can populate them.
      setAllocations(Object.fromEntries(receivedCards.map((r) => [r.certNumber, ""])));
      // Kick off the swap animation; the step-machine effect below
      // drives the rest of the timing (success state → fade → allocate).
      setStep("animating");
    } catch (err) {
      setExecuteError(err?.message ?? "Trade execution failed");
    } finally {
      setExecuting(false);
    }
  }

  // Animation step machine. Total run: 1.5s slide → 1.5s success →
  // 0.3s fade → allocation. Each transition is a setTimeout returned
  // so React's cleanup unwinds it if the component unmounts mid-flight.
  useEffect(() => {
    if (step !== "animating") return;
    const t = setTimeout(() => setStep("success"), 1500);
    return () => clearTimeout(t);
  }, [step]);
  useEffect(() => {
    if (step !== "success") return;
    const tFade = setTimeout(() => setOverlayExiting(true), 1500);
    const tEnd  = setTimeout(() => {
      setOverlayExiting(false);
      setStep("allocating");
    }, 1800);
    return () => { clearTimeout(tFade); clearTimeout(tEnd); };
  }, [step]);

  // ── Allocating step ──
  const allocatedSum = useMemo(() => {
    return Object.values(allocations).reduce((sum, raw) => {
      const n = parseFloat(raw);
      return sum + (Number.isFinite(n) && n >= 0 ? n : 0);
    }, 0);
  }, [allocations]);

  const remainder    = Math.round((totalCostBasis - allocatedSum) * 100) / 100;
  const overAllocated = remainder < 0;
  const fullyAllocated = Math.abs(remainder) < 0.01;
  const remainderColor = overAllocated ? "#f87171" : (fullyAllocated ? "#10b981" : "#94a3b8");

  function setAllocation(cert, raw) {
    setAllocations((prev) => ({ ...prev, [cert]: raw }));
  }

  function splitEvenly() {
    const n = persistedReceived.length;
    if (n === 0) return;
    const each = Math.round((totalCostBasis / n) * 100) / 100;
    // Last card absorbs any rounding remainder so the sum exactly matches
    // totalCostBasis (no $0.01 over/under-allocation surprises).
    const distributed = each * (n - 1);
    const last = Math.round((totalCostBasis - distributed) * 100) / 100;
    const next = {};
    persistedReceived.forEach((r, i) => {
      next[r.certNumber] = (i === n - 1 ? last : each).toFixed(2);
    });
    setAllocations(next);
  }

  async function handleConfirm() {
    setShowConfirmModal(false);
    setConfirmError(null);
    setConfirming(true);
    const newCardIds = persistedReceived.map((r) => r.id);
    try {
      await confirmTradeCost({
        tradeId,
        allocations: persistedReceived.map((r) => ({
          certNumber: r.certNumber,
          cost:       parseFloat(allocations[r.certNumber]) || 0,
        })),
      });
      // Targeted CardHedger refresh for the cards just received.
      // Bypasses the staleness gate and populates pricing before we
      // navigate so the user lands on My Collection with values already
      // filled in. Failures are swallowed — the next dashboard mount's
      // SWR refresh will pick up any cards that didn't get refreshed
      // here.
      try {
        await refreshPortfolio({ cardIds: newCardIds });
      } catch {
        /* non-fatal — confirm-cost already succeeded */
      }
      onTradeComplete(newCardIds);
    } catch (err) {
      setConfirmError(err?.message ?? "Confirmation failed");
      setConfirming(false);
    }
  }

  // Back from the allocation screen → call /trades/cancel to roll back
  // the executed-but-pending trade on the server, then flip the local
  // state back to building. Frontend selections (selectedIds,
  // receivedCards, cash) are preserved so the user can edit and
  // re-execute. We still show a brief "cancelling…" state so a slow
  // rollback doesn't make the Back button feel unresponsive.
  async function handleBack() {
    setCancelling(true);
    setConfirmError(null);
    try {
      await cancelTrade(tradeId);
      setTradeId(null);
      setPersistedReceived([]);
      setAllocations({});
      setStep("building");
    } catch (err) {
      setConfirmError(
        err?.message ?? "Couldn't cancel the trade. Refresh and try again."
      );
    } finally {
      setCancelling(false);
    }
  }

  // Net cash flow for the modal summary. Positive = cash in (received
  // more than gave), negative = cash out, zero = no cash leg.
  const netCashFlow = cashReceivedNum - cashGivenNum;

  if (step === "allocating") {
    return (
      <section style={st.page}>
        <header style={st.header}>
          <p style={st.eyebrow}><span style={st.dot} /> Cost Basis Allocation</p>
          <p style={st.subhead}>
            Distribute your cost basis across the cards you received. The
            allocation must sum exactly to the trade's total cost basis.
          </p>
        </header>

        <div style={st.allocSummaryRow}>
          <div style={st.allocSummaryItem}>
            <div style={st.allocSummaryLabel}>Total Cost Basis</div>
            <div style={st.allocSummaryValue}>{fmtUsd(totalCostBasis)}</div>
          </div>
          <div style={st.allocSummaryItem}>
            <div style={st.allocSummaryLabel}>Allocated</div>
            <div style={st.allocSummaryValue}>{fmtUsd(allocatedSum)}</div>
          </div>
          <div style={st.allocSummaryItem}>
            <div style={st.allocSummaryLabel}>{overAllocated ? "Over by" : "Remaining"}</div>
            <div style={{ ...st.allocSummaryValue, color: remainderColor }}>
              {fmtUsd(Math.abs(remainder))}
            </div>
          </div>
          <button type="button" style={st.splitBtn} onClick={splitEvenly}>
            Split Evenly
          </button>
        </div>

        <div style={st.allocList}>
          {persistedReceived.map((r) => (
            <div key={r.certNumber} style={st.allocRow}>
              <div style={st.allocCardThumbWrap}>
                {r.frontImageUrl ? (
                  <img src={r.frontImageUrl} alt="" style={st.allocCardThumb} loading="lazy" />
                ) : <div style={st.allocCardThumbEmpty}>🃏</div>}
              </div>
              <div style={st.allocMeta}>
                <div style={st.allocPlayer}>{r.playerName ?? "Unknown"}</div>
                <div style={st.allocSub}>
                  {[r.year, r.brand, r.grade ? `PSA ${r.grade}` : null].filter(Boolean).join(" · ")}
                </div>
                <div style={st.allocCert}>Cert {r.certNumber}</div>
              </div>
              <div style={st.allocInputWrap}>
                <span style={st.allocDollar}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={allocations[r.certNumber] ?? ""}
                  onChange={(e) => setAllocation(r.certNumber, e.target.value)}
                  style={st.allocInput}
                />
              </div>
            </div>
          ))}
        </div>

        {confirmError && <div style={st.errorMsg}>{confirmError}</div>}

        <div style={st.confirmBar}>
          <button
            type="button"
            onClick={handleBack}
            disabled={cancelling || confirming}
            style={{
              ...st.backBtn,
              ...(cancelling || confirming ? st.backBtnDisabled : {}),
            }}
          >
            {cancelling ? "Going back…" : "← Back"}
          </button>
          <button
            type="button"
            disabled={!fullyAllocated || confirming || cancelling}
            onClick={() => setShowConfirmModal(true)}
            style={{
              ...st.confirmBtn,
              ...(!fullyAllocated || confirming || cancelling ? st.confirmBtnDisabled : {}),
            }}
          >
            {confirming ? "Confirming & pricing new cards…" : "Confirm Trade →"}
          </button>
        </div>

        {showConfirmModal && (
          <ConfirmModal
            givenCards={givenCards}
            receivedCards={persistedReceived}
            netCashFlow={netCashFlow}
            onCancel={() => setShowConfirmModal(false)}
            onConfirm={handleConfirm}
          />
        )}
      </section>
    );
  }

  // ── Building step (also rendered underneath the animation overlay) ──
  const showOverlay = step === "animating" || step === "success";
  return (
    <section style={st.page}>
      {showOverlay && (
        <TradeAnimationOverlay
          givenCards={givenCards}
          receivedCards={receivedCards}
          pricingByCert={pricingByCert}
          step={step}
          exiting={overlayExiting}
        />
      )}
      <header style={st.header}>
        <p style={st.eyebrow}><span style={st.dot} /> Trade Builder</p>
        <p style={st.subhead}>
          Pick the cards you're sending, look up the cards you're getting,
          add cash on either side, then execute.
        </p>
      </header>

      <div style={st.columns}>
        {/* ── Left column: cards to give ── */}
        <div style={st.column}>
          <div style={st.columnHeader}>
            <span style={st.columnTitle}>You're Trading</span>
            <span style={st.columnCount}>{givenCards.length}</span>
          </div>

          {/* Search row — same 40px height as the right column's lookup
              row so the first card in each column lines up vertically.
              The icon sits inside the input via absolute positioning;
              padding-left makes room for it. */}
          <div style={st.searchRow}>
            <span style={st.searchIcon} aria-hidden="true">⌕</span>
            <input
              type="text"
              placeholder="Search by player, year, or brand"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={st.searchInput}
              aria-label="Search your tradable cards"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                style={st.searchClear}
                aria-label="Clear search"
              >×</button>
            )}
          </div>

          {tradableCards.length === 0 ? (
            <div style={st.columnEmpty}>
              No cards available to trade. Add cards to your portfolio first.
            </div>
          ) : filteredTradableCards.length === 0 ? (
            <div style={st.columnEmpty}>
              No cards match "{searchTerm}".
            </div>
          ) : (
            <TradeGivenScroller
              cards={filteredTradableCards}
              selectedIds={selectedIds}
              onToggle={toggleSelect}
            />
          )}

          <div style={st.cashRow}>
            <span style={st.cashLabel}>+ Cash You're Adding</span>
            <div style={st.cashInputWrap}>
              <span style={st.cashDollar}>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={cashGiven}
                onChange={(e) => setCashGiven(e.target.value)}
                style={st.cashInput}
              />
            </div>
          </div>
        </div>

        {/* ── Right column: cards to receive ── */}
        <div style={st.column}>
          <div style={st.columnHeader}>
            <span style={st.columnTitle}>You're Receiving</span>
            <span style={st.columnCount}>{receivedCards.length}</span>
          </div>

          <div style={st.lookupRow}>
            <input
              type="text"
              placeholder="PSA cert number"
              value={certInput}
              onChange={(e) => { setCertInput(e.target.value); setLookupError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleLookup(); } }}
              disabled={lookupLoading}
              style={st.lookupInput}
            />
            <button
              type="button"
              onClick={handleLookup}
              disabled={lookupLoading || !certInput.trim()}
              style={{ ...st.lookupBtn, ...(lookupLoading || !certInput.trim() ? st.lookupBtnDisabled : {}) }}
            >
              {lookupLoading ? "…" : "Look up"}
            </button>
          </div>
          {lookupError && <div style={st.lookupError}>{lookupError}</div>}

          {receivedCards.length === 0 ? (
            <div style={st.columnEmpty}>
              Look up PSA cert numbers above to add the cards you're receiving.
            </div>
          ) : (
            <div style={st.receivedGrid}>
              {receivedCards.map((r) => (
                <ReceivedCardTile
                  key={r.certNumber}
                  card={r}
                  pricing={pricingByCert[r.certNumber]}
                  onRemove={() => removeReceived(r.certNumber)}
                />
              ))}
            </div>
          )}

          <div style={st.cashRow}>
            <span style={st.cashLabel}>+ Cash You're Receiving</span>
            <div style={st.cashInputWrap}>
              <span style={st.cashDollar}>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                style={st.cashInput}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Summary + Execute ── */}
      <div style={st.summaryBar}>
        <div style={st.summarySide}>
          <div style={st.summaryLabel}>Trading</div>
          <div style={st.summaryValue}>
            {givenCards.length} card{givenCards.length === 1 ? "" : "s"}
            {cashGivenNum > 0 && <> + {fmtUsd(cashGivenNum)}</>}
          </div>
          <div style={st.summarySideTotal}>
            Total {fmtUsd(givenSideTotal)}
          </div>
        </div>
        <div style={st.summaryArrow}>⇄</div>
        <div style={st.summarySide}>
          <div style={st.summaryLabel}>Receiving</div>
          <div style={st.summaryValue}>
            {receivedCards.length} card{receivedCards.length === 1 ? "" : "s"}
            {cashReceivedNum > 0 && <> + {fmtUsd(cashReceivedNum)}</>}
          </div>
          <div style={st.summarySideTotal}>
            Total {anyReceivedLoading ? "…" : fmtUsd(receivedSideTotal)}
          </div>
        </div>
      </div>

      {/* Trade-value differential row. Hidden until both sides have at
          least one card so the chip doesn't show "−$X" on an empty
          builder. Color flips: green when receiving more, red when
          giving more, grey at parity. */}
      {givenCards.length > 0 && receivedCards.length > 0 && !anyReceivedLoading && (
        <div style={st.diffRow}>
          <span style={st.diffLabel}>Trade Value Difference</span>
          <span style={{
            ...st.diffValue,
            color:
              Math.abs(tradeDifference) < 0.01 ? "#94a3b8" :
              tradeDifference > 0 ? "#10b981" : "#f87171",
          }}>
            {Math.abs(tradeDifference) < 0.01
              ? "Even trade"
              : `${tradeDifference > 0 ? "+" : "−"}${fmtUsd(Math.abs(tradeDifference))} ${tradeDifference > 0 ? "in your favor" : "against you"}`}
          </span>
        </div>
      )}

      {executeError && <div style={st.errorMsg}>{executeError}</div>}

      {analysisError && <div style={st.errorMsg}>{analysisError}</div>}

      <div style={st.executeWrap}>
        <button
          type="button"
          disabled={!hasCachedAnalysis && !canAnalyze}
          onClick={hasCachedAnalysis ? () => setShowResult(true) : handleAnalyze}
          style={{
            ...st.analyzeBtn,
            ...((!hasCachedAnalysis && !canAnalyze) ? st.analyzeBtnDisabled : {}),
          }}
        >
          {analyzing ? (
            <><span style={st.executeSpinner} aria-hidden="true" /> Analyzing…</>
          ) : hasCachedAnalysis ? (
            <><span style={st.analyzeMark}>✦</span> View Analysis</>
          ) : (
            <><span style={st.analyzeMark}>✦</span> Analyze Trade</>
          )}
        </button>
        <button
          type="button"
          disabled={!canExecute}
          onClick={handleExecute}
          style={{ ...st.executeBtn, ...(!canExecute ? st.executeBtnDisabled : {}) }}
        >
          {executing ? (
            <><span style={st.executeSpinner} aria-hidden="true" /> Executing trade…</>
          ) : (
            <><span style={st.executeMark}>◆</span> Execute Trade <span style={st.executeArrow}>→</span></>
          )}
        </button>
      </div>

      {analyzing && (
        <AnalysisLoadingModal
          result={analysisResult}
          onComplete={handleAnalysisLoadingComplete}
        />
      )}

      {showResult && analysisResult && (
        <AnalysisModal
          result={analysisResult}
          onClose={() => setShowResult(false)}
        />
      )}

      <TradeHistory trades={pastTrades} loading={historyLoading} error={historyError} />
    </section>
  );
}

// Full-screen overlay rendered while step ∈ {"animating", "success"}.
// Mounts on top of the building UI so that screen stays in DOM
// underneath; the parent unmounts the overlay and swaps to the
// allocation screen once step transitions to "allocating".
//
// Visual: two horizontal rows of card thumbnails. Given cards live on
// the left and slide rightward; received cards live on the right and
// slide leftward. Both pass through the centre simultaneously with a
// scale pulse — animation defined in index.css. Cubic-bezier easing
// is set via the `animation-timing-function` property on the rows.
function TradeAnimationOverlay({ givenCards, receivedCards, pricingByCert, step, exiting }) {
  const overlayStyle = {
    ...st.animOverlay,
    ...(exiting ? st.animOverlayExiting : {}),
  };
  return (
    <div style={overlayStyle} aria-live="polite" role="status">
      {step === "animating" && (
        <>
          <div style={{ ...st.animRow, ...st.animRowGiven }}>
            {givenCards.map((c, i) => (
              <AnimThumbnail
                key={c.id}
                imageUrl={c.imageUrl}
                playerName={c.playerName}
                grade={c.grade}
                grader={c.grader ?? "PSA"}
                index={i}
              />
            ))}
          </div>
          <div style={{ ...st.animRow, ...st.animRowReceived }}>
            {receivedCards.map((r, i) => (
              <AnimThumbnail
                key={r.certNumber}
                imageUrl={pricingByCert[r.certNumber]?.cardhedgerImageUrl ?? null}
                playerName={r.playerName}
                grade={r.grade}
                grader={r.grader ?? "PSA"}
                index={i}
              />
            ))}
          </div>
        </>
      )}
      {step === "success" && (
        <div style={st.animSuccess}>
          <div style={st.animCheckCircle} aria-hidden="true">
            <svg viewBox="0 0 64 64" width="56" height="56" style={{ display: "block" }}>
              <polyline
                points="14,34 27,46 50,20"
                fill="none" stroke="#0f172a"
                strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={st.animSuccessText}>Trade Executed!</div>
        </div>
      )}
    </div>
  );
}

function AnimThumbnail({ imageUrl, playerName, grade, grader, index }) {
  return (
    <div style={st.animThumb}>
      {imageUrl ? (
        <img src={imageUrl} alt="" style={st.animThumbImg} draggable={false} />
      ) : (
        <div style={st.animThumbEmpty}>🃏</div>
      )}
      <div style={st.animThumbLabel}>
        <div style={st.animThumbPlayer}>{playerName ?? "Unknown"}</div>
        <div style={st.animThumbGrade}>
          {grader} {grade}
        </div>
      </div>
    </div>
  );
}

// Single received-card tile. Self-contained hover state + image
// resolution so each tile manages its own UI without bubbling state up.
//
// Image source matches the portfolio chain: pull cardhedgerImageUrl
// from /pricing/preview when it lands. While the lookup is in flight
// we render the same skeleton-shimmer treatment used elsewhere on
// the dashboard so the tile doesn't look broken before pricing
// resolves. PSA CDN URLs (r.frontImageUrl) are intentionally NOT
// used — the portfolio doesn't use them either after the recent
// image-resolution change.
function ReceivedCardTile({ card, pricing, onRemove }) {
  const [hovered, setHovered] = useState(false);
  const status      = pricing?.status ?? "loading";
  const imageUrl    = status === "loaded" ? pricing.cardhedgerImageUrl : null;
  const showSkeleton = status === "loading";

  return (
    <div
      style={{ ...st.cardTile, ...st.cardTileReceived }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Image area */}
      <div style={st.receivedImageWrap}>
        {imageUrl ? (
          <img src={imageUrl} alt="" style={st.cardImg} loading="lazy" />
        ) : showSkeleton ? (
          <div style={st.cardImgSkeleton} />
        ) : (
          <div style={st.cardImgEmpty}>🃏</div>
        )}

        {/* Grade badge — bottom-left, mirrors PortfolioPage's gradeBadge */}
        {card.grade && (
          <div style={st.gradeBadge}>
            <img src="/psa.avif" alt="PSA" style={st.gradeBadgeLogo} />
            <span style={st.gradeBadgeValue}>{card.grade}</span>
          </div>
        )}

        {/* Hover-only remove button — top-right, matching PortfolioPage's
            tileActions overlay + deleteBtn style. */}
        <div style={{ ...st.tileActions, opacity: hovered ? 1 : 0 }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            style={st.deleteBtn}
            aria-label="Remove from trade"
            title="Remove"
          >✕</button>
        </div>
      </div>

      {/* Label area */}
      <div style={st.cardLabel}>
        <div style={st.cardPlayer}>{card.playerName ?? "Unknown"}</div>
        <div style={st.cardMeta}>
          {[card.year, card.brand].filter(Boolean).join(" · ") || "—"}
        </div>
        <div style={st.financeRow}>
          <span style={st.financeLabel}>Value</span>
          {status === "loading" && (
            <span style={st.financeLoading}>Fetching value…</span>
          )}
          {status === "loaded" && (
            <span style={st.financeValue}>{fmtUsd(pricing.avgSalePrice)}</span>
          )}
          {status === "unavailable" && (
            <span style={st.financeUnavailable}>No pricing data</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Builds the full card title string for the confirmation modal —
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

// Pre-confirm modal — shown when the user clicks Confirm Trade. Surfaces
// the irreversibility ("cannot be undone") and a per-card summary of
// what's about to happen so they don't fire confirm-cost on autopilot.
//
// Card lists are individually scroll-capped so 10+ cards on a side
// don't push the actions bar off-screen. Sections render even when
// empty so the structure stays predictable across one-sided trades.
function ConfirmModal({ givenCards, receivedCards, netCashFlow, onCancel, onConfirm }) {
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

// ── AI Analysis loading modal ──────────────────────────────────────────
// Shown while the analyze-trade request is in flight. The progress bar
// auto-advances 0→95% over ~12 seconds — never reaching 100% on its own.
// When the parent passes the result down (`result` flips from null to
// the analysis object), the bar jumps to 100%, the success message
// shows for ~700ms (let the user see the celebratory finish), then
// onComplete fires so the parent can swap to the result modal.
//
// Messages are mapped to the current progress %; the spec ties story
// beats to specific brackets. Each message change triggers the
// scp-msg-fade-in keyframe via React's key prop — when the key (the
// message text itself) changes the element re-mounts and the animation
// replays.
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

function AnalysisLoadingModal({ result, onComplete }) {
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
function AnalysisModal({ result, onClose }) {
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

// ── Horizontal scroller for "You're Trading" tiles ────────────────────
// Lifted into its own component so scroll-tracking state doesn't
// re-render the whole TradeTab on every scroll tick. The progress bar
// is updated via a ref directly (DOM mutation, no React re-render);
// only the arrow-visibility booleans flow through React state, and
// they're set with a referential-equality guard so identical-boundary
// scrolls don't trigger renders.
function TradeGivenScroller({ cards, selectedIds, onToggle }) {
  const scrollerRef = useRef(null);
  const progressRef = useRef(null);
  const [bounds, setBounds] = useState({ atStart: true, atEnd: false });

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pct = max > 0 ? (el.scrollLeft / max) * 100 : 0;
    if (progressRef.current) progressRef.current.style.width = `${pct}%`;
    const next = {
      atStart: el.scrollLeft <= 1,
      atEnd:   max <= 1 || el.scrollLeft >= max - 1,
    };
    setBounds((prev) =>
      prev.atStart === next.atStart && prev.atEnd === next.atEnd ? prev : next
    );
  }, []);

  // Re-evaluate boundaries whenever the card list changes (filter typed,
  // selection toggled). A ResizeObserver also kicks in if the container
  // resizes (e.g. window resize on desktop).
  useEffect(() => {
    update();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cards.length, update]);

  function nudge(dir) {
    const el = scrollerRef.current;
    if (!el) return;
    // Scroll roughly one tile-and-a-half so the next/previous tile
    // lands fully into view rather than half-revealed.
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.7), behavior: "smooth" });
  }

  return (
    <div className="scp-trade-scroller-wrap" style={st.scrollerWrap}>
      <div
        ref={scrollerRef}
        className="scp-trade-scroller"
        style={st.scroller}
        onScroll={update}
      >
        {cards.map((c) => {
          const selected = selectedIds.has(c.id);
          const myCost   = c.myCost != null ? parseFloat(c.myCost) : null;
          const estValue = effectiveValue(c);
          const pnl      = cardPnl(c);
          const pnlColor = pnl == null ? "#94a3b8" : (pnl >= 0 ? "#10b981" : "#f87171");
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              style={{ ...st.cardTile, ...st.scrollerTile, ...(selected ? st.cardTileSelected : {}) }}
            >
              {c.imageUrl ? (
                <img src={c.imageUrl} alt="" style={st.cardImg} loading="lazy" />
              ) : <div style={st.cardImgEmpty}>🃏</div>}
              {selected && <div style={st.checkOverlay}>✓</div>}
              <div style={st.cardLabel}>
                <div style={st.cardPlayer}>{c.playerName ?? "Unknown"}</div>
                <div style={st.cardMeta}>PSA {c.grade}</div>
                <div style={st.financeRow}>
                  <span style={st.financeLabel}>Cost</span>
                  <span style={st.financeCost}>{fmtUsd(myCost)}</span>
                </div>
                <div style={st.financeRow}>
                  <span style={st.financeLabel}>Value</span>
                  <span style={st.financeValue}>{fmtUsd(estValue)}</span>
                </div>
                <div style={st.financeRow}>
                  <span style={st.financeLabel}>P&amp;L</span>
                  <span style={{ ...st.financePnl, color: pnlColor }}>
                    {pnl == null ? "—" : `${pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(pnl))}`}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!bounds.atStart && (
        <button
          type="button"
          onClick={() => nudge(-1)}
          className="scp-trade-scroller-arrow"
          style={{ ...st.scrollerArrow, ...st.scrollerArrowLeft }}
          aria-label="Scroll left"
        >‹</button>
      )}
      {!bounds.atEnd && (
        <button
          type="button"
          onClick={() => nudge(1)}
          className="scp-trade-scroller-arrow"
          style={{ ...st.scrollerArrow, ...st.scrollerArrowRight }}
          aria-label="Scroll right"
        >›</button>
      )}

      <div style={st.scrollerProgressTrack} aria-hidden="true">
        <div ref={progressRef} style={st.scrollerProgressFill} />
      </div>
    </div>
  );
}

// ── Past Trades section ────────────────────────────────────────────────
// Reverse-chronological list of executed trades. Each row collapses to a
// summary (date · given chips · received chips · net P&L) and expands on
// click into the full per-card detail. Trade-time snapshots are read from
// trade_cards so the history stays accurate even if the live cards table
// changes later.
function TradeHistory({ trades, loading, error }) {
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

// ── Styles ─────────────────────────────────────────────────────────────
const st = {
  page: { display: "flex", flexDirection: "column", gap: "1.5rem" },
  header: { marginBottom: "0.5rem" },
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
  subhead: {
    fontSize: "0.92rem", color: "#94a3b8",
    margin: "0.6rem 0 0", lineHeight: 1.5,
    maxWidth: 640,
  },

  // ── Two-column layout ──
  // Equal-width columns. minWidth: 0 on the column itself is the
  // critical bit — grid items default to min-width: auto (= min-content),
  // which causes a column with wide flex content (the horizontal
  // scroller's many tiles) to refuse to shrink and push the right
  // column off-screen. Locking it to 0 makes 1fr 1fr actually behave.
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
  },
  column: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "1.5rem",
    display: "flex", flexDirection: "column",
    gap: "1.25rem",
    minHeight: 420,
    minWidth: 0,
  },
  columnHeader: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: "0.85rem",
    borderBottom: "1px solid rgba(245,158,11,0.18)",
  },
  columnTitle: {
    fontSize: "0.95rem", fontWeight: 800,
    letterSpacing: "0.04em", color: "#f1f5f9",
  },
  columnCount: {
    background: "rgba(245,158,11,0.15)",
    border: "1px solid rgba(245,158,11,0.4)",
    color: "#fbbf24",
    fontSize: "0.78rem", fontWeight: 800,
    padding: "0.15rem 0.6rem", borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
  },
  columnEmpty: {
    color: "#64748b", fontSize: "0.85rem",
    fontStyle: "italic", textAlign: "center",
    padding: "2rem 1rem",
    background: "rgba(255,255,255,0.02)",
    border: "1px dashed rgba(255,255,255,0.08)",
    borderRadius: 10,
  },

  // ── Card tiles ──
  // Right column is still a grid (lookup → fixed list of received cards).
  // Left column is now a single horizontal scroller — see scrollerWrap
  // / scroller below. minmax(220px, 1fr) keeps received-card widths
  // visually consistent with the scroller's fixed-220px tiles.
  receivedGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gridAutoRows: "1fr",
    gap: "0.85rem",
  },

  // ── Left column search row ──
  // Same 40px height as the right column's lookup row so both columns'
  // first tile starts at the same vertical position.
  searchRow: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  searchIcon: {
    position: "absolute",
    left: "0.75rem",
    color: "rgba(245,158,11,0.7)",
    fontSize: "1rem",
    pointerEvents: "none",
  },
  searchInput: {
    flex: 1,
    height: 40,
    padding: "0 2.25rem 0 2.1rem",
    borderRadius: 8,
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#f1f5f9",
    fontSize: "0.92rem", fontFamily: "inherit",
    outline: "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  searchClear: {
    position: "absolute",
    right: "0.55rem",
    width: 22, height: 22,
    border: "none",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.08)",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: "0.95rem",
    lineHeight: "22px",
    padding: 0,
    fontFamily: "inherit",
  },

  // ── Horizontal scroller ──
  // maxWidth caps the visible window at ~2 tiles (220px × 2 + 0.85rem
  // gap ≈ 454px → rounded to 460). width: 100% lets it shrink on
  // narrow viewports so it never overflows the column.
  scrollerWrap: {
    position: "relative",
    width: "100%",
    maxWidth: 460,
    margin: "0 -0.25rem",   // bleed slightly past the column padding so
                            // arrow circles don't crowd the first/last tile
    padding: "0.25rem 0.25rem 0",
  },
  scroller: {
    display: "flex",
    flexDirection: "row",
    gap: "0.85rem",
    overflowX: "auto",
    overflowY: "hidden",
    scrollSnapType: "x mandatory",
    scrollPadding: "0 0.25rem",
    paddingBottom: "0.35rem",
    WebkitOverflowScrolling: "touch",
  },
  // Override the grid-only scrollerTile sizing — fixed 220px per spec
  // ("don't shrink to fit more in view"). flex: 0 0 means the tile
  // never grows or shrinks, just sits at its declared basis.
  scrollerTile: {
    flex: "0 0 220px",
    scrollSnapAlign: "start",
  },

  // ── Arrow buttons ──
  scrollerArrow: {
    position: "absolute",
    top: "calc(50% - 0.6rem)",  // visually centred against the tile body,
                                 // not the progress bar at the bottom
    transform: "translateY(-50%)",
    width: 36, height: 36,
    borderRadius: "50%",
    background: "rgba(245,158,11,0.85)",
    color: "#0f172a",
    border: "1px solid rgba(245,158,11,0.95)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.5), 0 0 0 4px rgba(15,23,42,0.6)",
    fontSize: "1.2rem", fontWeight: 800, lineHeight: 1,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 0,
    zIndex: 2,
  },
  scrollerArrowLeft:  { left:  "-0.5rem" },
  scrollerArrowRight: { right: "-0.5rem" },

  // ── Progress indicator ──
  scrollerProgressTrack: {
    height: 2,
    marginTop: "0.65rem",
    background: "rgba(245,158,11,0.12)",
    borderRadius: 999,
    overflow: "hidden",
  },
  scrollerProgressFill: {
    height: "100%",
    width: "0%",
    background: "linear-gradient(90deg, rgba(245,158,11,0.7), rgba(251,191,36,1))",
    borderRadius: 999,
    transition: "width 0.12s ease",
  },
  cardTile: {
    position: "relative",
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10,
    overflow: "hidden",
    cursor: "pointer",
    padding: 0,
    fontFamily: "inherit",
    transition: "border-color 0.2s, box-shadow 0.2s, transform 0.15s",
    textAlign: "left",
    color: "inherit",
  },
  cardTileSelected: {
    borderColor: "#f59e0b",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.5), 0 0 24px rgba(245,158,11,0.25)",
    transform: "translateY(-2px)",
  },
  cardTileReceived: {
    borderColor: "rgba(96,165,250,0.4)",
    boxShadow: "0 0 0 1px rgba(96,165,250,0.2)",
    cursor: "default",
  },
  cardImg: {
    width: "100%",
    aspectRatio: "5 / 7",
    // contain (not cover) so we never crop or upscale beyond the
    // image's natural resolution. CardHedger ships pre-resized
    // images that are typically smaller than the rendered tile —
    // with cover, those got bilinear-upscaled and looked pixelated.
    // Letterboxing on the dark tile background is preferable to
    // smeared interpolation. imageRendering: auto is the default
    // but explicit so any future global override doesn't bite us.
    objectFit: "contain",
    imageRendering: "auto",
    display: "block",
    background: "#06090f",
  },
  cardImgEmpty: {
    width: "100%",
    aspectRatio: "5 / 7",
    background: "#06090f",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "1.6rem",
  },
  checkOverlay: {
    position: "absolute",
    top: 8, right: 8,
    width: 28, height: 28,
    background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
    color: "#0f172a",
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.95rem", fontWeight: 900,
    boxShadow: "0 4px 12px rgba(245,158,11,0.5)",
  },
  // Wraps the image + overlays so absolute-positioned badge/actions
  // anchor to the image rather than the whole tile. Card-shaped 5:7
  // matches the left-tile cardImg footprint.
  receivedImageWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "5 / 7",
    background: "#06090f",
    overflow: "hidden",
  },
  // Skeleton shimmer rendered while pricing-preview is in flight.
  // Reuses the global skeletonShimmer keyframe defined in index.css.
  cardImgSkeleton: {
    width: "100%",
    height: "100%",
    background: "linear-gradient(110deg, rgba(255,255,255,0.025) 30%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.025) 70%)",
    backgroundSize: "200% 100%",
    animation: "skeletonShimmer 1.4s ease-in-out infinite",
  },
  // Grade badge mirroring PortfolioPage's bottom-left PSA logo + grade
  // chip. Sized down slightly for the smaller trade tiles.
  gradeBadge: {
    position: "absolute", bottom: 8, left: 8,
    display: "flex", alignItems: "center", gap: "0.3rem",
    background: "rgba(15,23,42,0.88)",
    border: "1px solid rgba(245,158,11,0.4)",
    borderRadius: 4,
    padding: "2px 0.45rem 2px 2px",
    backdropFilter: "blur(8px)",
    pointerEvents: "none",
    zIndex: 2,
  },
  gradeBadgeLogo: {
    height: 16,
    width: "auto",
    display: "block",
    background: "#fff",
    padding: "1px 3px",
    borderRadius: 2,
  },
  gradeBadgeValue: {
    fontSize: "0.78rem", fontWeight: 800,
    color: "#f59e0b", lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  // Hover-only top-right actions — same envelope as PortfolioPage's
  // tileActions overlay so the trade tab feels native to the rest of
  // the card UI.
  tileActions: {
    position: "absolute", top: 8, right: 8,
    transition: "opacity 0.15s",
    zIndex: 3,
  },
  deleteBtn: {
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#cbd5e1",
    borderRadius: "50%",
    width: 26, height: 26, fontSize: "0.7rem",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(8px)",
    padding: 0, lineHeight: 1,
  },
  cardLabel: {
    padding: "0.55rem 0.7rem 0.65rem",
    background: "linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.85) 100%)",
  },
  cardPlayer: {
    fontSize: "0.78rem", fontWeight: 700,
    color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  cardMeta: {
    fontSize: "0.65rem", color: "#94a3b8",
    marginTop: "0.15rem", letterSpacing: "0.04em",
  },
  // Per-tile finance rows — three slim lines (cost, value, P&L on
  // left tiles; just value on right tiles) sitting under the player
  // name. Tabular nums so they line up across the grid.
  financeRow: {
    display: "flex", justifyContent: "space-between",
    alignItems: "baseline", gap: "0.4rem",
    marginTop: "0.25rem",
    fontSize: "0.68rem",
    fontVariantNumeric: "tabular-nums",
  },
  financeLabel: {
    color: "#64748b", fontWeight: 600,
    letterSpacing: "0.06em", textTransform: "uppercase",
    fontSize: "0.55rem",
  },
  financeCost:        { color: "#94a3b8", fontWeight: 600 },
  financeValue:       { color: "#fbbf24", fontWeight: 800 },
  financePnl:         { fontWeight: 800 },
  financeLoading:     { color: "#94a3b8", fontStyle: "italic", fontSize: "0.62rem" },
  financeUnavailable: { color: "#64748b", fontStyle: "italic", fontSize: "0.62rem" },

  // ── PSA cert lookup ──
  lookupRow: { display: "flex", gap: "0.5rem" },
  lookupInput: {
    flex: 1,
    height: 40,
    padding: "0 0.85rem",
    borderRadius: 8,
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#f1f5f9",
    fontSize: "0.92rem", fontFamily: "inherit",
    outline: "none",
    fontVariantNumeric: "tabular-nums",
  },
  lookupBtn: {
    height: 40, padding: "0 1.1rem",
    borderRadius: 8,
    background: "#f59e0b", color: "#0f172a",
    border: "none",
    fontSize: "0.85rem", fontWeight: 800,
    letterSpacing: "0.02em",
    cursor: "pointer",
    transition: "background 0.2s",
  },
  lookupBtnDisabled: {
    background: "rgba(245,158,11,0.3)",
    color: "rgba(15,23,42,0.6)",
    cursor: "not-allowed",
  },
  lookupError: {
    color: "#f87171",
    fontSize: "0.78rem",
    marginTop: "-0.25rem",
  },

  // ── Cash inputs ──
  cashRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    gap: "0.85rem",
    paddingTop: "1rem",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    marginTop: "auto",
  },
  cashLabel: {
    fontSize: "0.78rem", fontWeight: 700,
    letterSpacing: "0.06em", color: "#cbd5e1",
  },
  cashInputWrap: {
    display: "flex", alignItems: "center",
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    padding: "0 0.6rem",
    width: 160,
  },
  cashDollar: {
    color: "#94a3b8", fontWeight: 700, marginRight: "0.3rem",
  },
  cashInput: {
    height: 38, flex: 1,
    background: "transparent", border: "none", outline: "none",
    color: "#f1f5f9",
    fontSize: "0.95rem", fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
  },

  // ── Summary bar + Execute ──
  summaryBar: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: "1.5rem",
    padding: "1.25rem 1.75rem",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 14,
  },
  summarySide: { textAlign: "center" },
  summaryLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#64748b", marginBottom: "0.35rem",
  },
  summaryValue: {
    fontSize: "1.05rem", fontWeight: 800,
    color: "#f1f5f9",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  summarySideTotal: {
    fontSize: "0.78rem", color: "#fbbf24",
    marginTop: "0.4rem", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  },
  summaryArrow: {
    fontSize: "1.5rem", color: "#f59e0b", fontWeight: 800,
  },
  diffRow: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: "0.85rem",
    padding: "0.7rem 1rem",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10,
  },
  diffLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#64748b",
  },
  diffValue: {
    fontSize: "1rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },
  executeWrap: {
    display: "flex", justifyContent: "center",
    gap: "0.85rem",
    marginTop: "0.5rem",
    flexWrap: "wrap",
  },
  // Gold-outlined secondary action — visually subordinate to the
  // primary Execute button but still gold so it reads as an
  // intelligence/action affordance.
  analyzeBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.55rem",
    padding: "1rem 1.6rem",
    borderRadius: 10,
    background: "transparent",
    color: "#fbbf24",
    border: "1.5px solid rgba(245,158,11,0.65)",
    fontSize: "0.95rem", fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s",
  },
  analyzeBtnDisabled: {
    color: "rgba(245,158,11,0.4)",
    borderColor: "rgba(245,158,11,0.25)",
    cursor: "not-allowed",
  },
  analyzeMark: { fontSize: "1rem", lineHeight: 1 },

  executeBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.6rem",
    padding: "1rem 2.4rem",
    borderRadius: 10,
    background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
    color: "#0f172a",
    border: "none",
    fontSize: "1rem", fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(245,158,11,0.35), 0 0 0 1px rgba(245,158,11,0.45)",
    transition: "transform 0.1s, box-shadow 0.2s",
  },
  executeBtnDisabled: {
    background: "rgba(245,158,11,0.25)",
    color: "rgba(15,23,42,0.6)",
    cursor: "not-allowed",
    boxShadow: "none",
  },
  executeMark: { fontSize: "0.85rem" },
  executeArrow: { fontSize: "1.1rem" },
  // Spinner shown while POST /trades/execute is in flight. Border-trick
  // ring; rotation driven by scp-spin keyframe in index.css.
  executeSpinner: {
    width: 16, height: 16,
    borderRadius: "50%",
    border: "2px solid rgba(15,23,42,0.25)",
    borderTopColor: "#0f172a",
    animation: "scp-spin 0.7s linear infinite",
    display: "inline-block",
  },
  errorMsg: {
    color: "#f87171",
    fontSize: "0.85rem",
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.3)",
    borderRadius: 8,
    padding: "0.65rem 0.95rem",
  },

  // ── Allocation step ──
  // minmax(140px, 1fr) on each stat column gives each box a hard minimum
  // so it can't collapse below the rendered dollar value's width. The
  // splitBtn keeps its auto sizing so it hugs its label.
  allocSummaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(140px, 1fr)) auto",
    gap: "1rem",
    alignItems: "end",
    padding: "1.25rem 1.5rem",
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 14,
  },
  allocSummaryItem: {
    display: "flex", flexDirection: "column", gap: "0.3rem",
    minWidth: 0, // permits the ellipsis fallback below to engage
  },
  allocSummaryLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  // clamp() lets the value scale from 1rem on narrow viewports up to
  // 1.45rem on wide ones, so the typography stays balanced without
  // breaking the box. nowrap + overflow:hidden + ellipsis is the
  // belt-and-suspenders fallback if the value still exceeds the
  // column at the smallest clamped size.
  allocSummaryValue: {
    fontSize: "clamp(1rem, 2.2vw, 1.45rem)",
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    color: "#f1f5f9",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  splitBtn: {
    height: 40, padding: "0 1rem",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid rgba(245,158,11,0.5)",
    color: "#fbbf24",
    fontSize: "0.82rem", fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: "pointer",
    transition: "background 0.2s",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  allocList: { display: "flex", flexDirection: "column", gap: "0.85rem" },
  allocRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    gap: "1rem",
    padding: "0.85rem 1.1rem",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 12,
  },
  allocCardThumbWrap: { width: 60, flexShrink: 0 },
  allocCardThumb: {
    width: "100%",
    aspectRatio: "5 / 7",
    objectFit: "cover",
    borderRadius: 4,
    background: "#06090f",
  },
  allocCardThumbEmpty: {
    width: "100%", aspectRatio: "5 / 7",
    background: "#06090f", borderRadius: 4,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "1.2rem",
  },
  allocMeta: { minWidth: 0 },
  allocPlayer: {
    fontSize: "0.95rem", fontWeight: 800,
    color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  allocSub: {
    fontSize: "0.78rem", color: "#94a3b8", marginTop: "0.15rem",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  allocCert: {
    fontSize: "0.7rem", color: "#64748b", marginTop: "0.1rem", letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  // Width: 160 was a hard cap that crowded long player names on narrow
  // viewports. Switching to minWidth + flexShrink: 0 keeps the input
  // legible at a known floor without forcing layout overflow.
  allocInputWrap: {
    display: "flex", alignItems: "center",
    background: "rgba(15,23,42,0.85)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    padding: "0 0.6rem",
    minWidth: 140,
    flexShrink: 0,
  },
  allocDollar: { color: "#94a3b8", fontWeight: 700, marginRight: "0.3rem" },
  allocInput: {
    height: 40, flex: 1,
    background: "transparent", border: "none", outline: "none",
    color: "#f1f5f9",
    fontSize: "1rem", fontFamily: "inherit", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    minWidth: 0, // lets the input shrink within its wrap when needed
  },
  // Back + Confirm sit on the same row. Back is an outlined ghost
  // button anchored left so the gold Confirm stays visually dominant.
  confirmBar: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    marginTop: "0.5rem",
  },
  backBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
    padding: "0.85rem 1.4rem",
    borderRadius: 10,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#cbd5e1",
    fontSize: "0.92rem", fontWeight: 700,
    letterSpacing: "0.03em",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  },
  backBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  confirmBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.5rem",
    padding: "1rem 2.4rem",
    borderRadius: 10,
    background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
    color: "#0f172a",
    border: "none",
    fontSize: "1rem", fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(245,158,11,0.35), 0 0 0 1px rgba(245,158,11,0.45)",
  },
  confirmBtnDisabled: {
    background: "rgba(245,158,11,0.25)",
    color: "rgba(15,23,42,0.6)",
    cursor: "not-allowed",
    boxShadow: "none",
  },

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

  // ── Trade animation overlay ──
  // Full-screen dark wash. opacity transitions for the fade-out into
  // the allocation screen. overflow hidden so cards sliding past the
  // viewport edge don't add a horizontal scrollbar.
  animOverlay: {
    position: "fixed", inset: 0, zIndex: 5000,
    background: "rgba(0,0,0,0.92)",
    overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "opacity 0.3s ease",
    opacity: 1,
  },
  animOverlayExiting: {
    opacity: 0,
  },

  // Both rows share the same animation envelope; each has its own
  // keyframe that translates in opposite directions. Anchored vertically
  // a bit above (given) and below (received) the centre line so they
  // slide on adjacent horizontal lanes — the cards visually pass each
  // other rather than stacking exactly. The entire row animates as a
  // unit so cards stay in formation through the swap.
  animRow: {
    position: "absolute",
    display: "flex", gap: "1rem",
    animationDuration: "1.5s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    animationFillMode: "forwards",
    willChange: "transform",
  },
  animRowGiven: {
    left: "5vw",
    top: "calc(50% - 110px)",
    animationName: "scp-trade-slide-right",
  },
  animRowReceived: {
    right: "5vw",
    top: "calc(50% + 30px)",
    animationName: "scp-trade-slide-left",
  },

  animThumb: {
    width: 120,
    background: "#0f172a",
    border: "1px solid rgba(245,158,11,0.45)",
    borderRadius: 10,
    overflow: "hidden",
    boxShadow: "0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.18)",
    flexShrink: 0,
  },
  animThumbImg: {
    width: "100%",
    aspectRatio: "5 / 7",
    objectFit: "contain",
    background: "#06090f",
    display: "block",
  },
  animThumbEmpty: {
    width: "100%",
    aspectRatio: "5 / 7",
    background: "#06090f",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "1.6rem",
  },
  animThumbLabel: {
    padding: "0.4rem 0.55rem 0.5rem",
  },
  animThumbPlayer: {
    fontSize: "0.7rem", fontWeight: 700,
    color: "#f1f5f9",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  animThumbGrade: {
    fontSize: "0.6rem",
    color: "#fbbf24",
    marginTop: "0.15rem",
    letterSpacing: "0.06em",
    fontVariantNumeric: "tabular-nums",
  },

  // Success state — replaces the slide rows with a centered checkmark
  // + label. scp-trade-success-pop keyframe gives the check a brief
  // overshoot pop so it feels like a confirmation, not just a fade.
  animSuccess: {
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: "1.25rem",
    animation: "scp-trade-success-pop 0.3s ease forwards",
  },
  animCheckCircle: {
    width: 96, height: 96,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #34d399, #10b981)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 12px 36px rgba(16,185,129,0.5), 0 0 0 6px rgba(16,185,129,0.18)",
  },
  animSuccessText: {
    fontSize: "1.65rem", fontWeight: 800,
    color: "#f1f5f9",
    letterSpacing: "-0.02em",
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
