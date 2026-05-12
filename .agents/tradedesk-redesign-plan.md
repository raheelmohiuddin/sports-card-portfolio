# TradeDesk Redesign — Phase 1 (Plan)

> Phase 1 deliverable: design + implementation plan only. No frontend code yet.
> All backend Lambdas (`execute-trade`, `confirm-cost`, `cancel-trade`) stay
> on their current contracts.

Branch: `tradedesk-redesign`. Plan owner: review before phase 2 starts.

---

## 1. Overview

Replace the current step-machine TradeTab (`building → animating → success → allocating` as four full-screen states) with a **single living trade canvas**: two symmetric panels — *Your Side* (left, drawn from your portfolio) and *Their Side* (right, off-platform via PSA cert lookup) — sandwiching a central *Net Delta* chip that quietly tweens as you build. The allocation step no longer hijacks the screen; it slides in beneath the canvas the moment the trade enters the `pending` state, and the canvas above stays present (and read-only) so you always see what you're allocating against. The whole experience reads like a desk pad you're laying cards on, not a wizard you're stepping through.

**North star moment.** The collector is at a card show. They tap a card from their portfolio → it lifts off the left panel and settles into *Your Side*. The PSA-cert input is already focused; they type the counterparty's cert, hit Enter, and a card *materializes* into *Their Side* with a soft scale-in. The Net Delta chip in the middle tweens from grey to a quiet ▲ +$340 in your favor. They tap Execute, the canvas dims to read-only, and the allocation panel slides up beneath it with auto-split values already in place. They glance at the allocation, hit Confirm, and the canvas fades out cleanly — the whole interaction took twenty seconds and looked like a single fluid gesture.

---

## 2. Layout

**Target viewport:** desktop-first, optimised for 1280–1600px wide. Canvas max-width 1280px, centered. Mobile is a separate later session — layout will collapse to a single-column stack with a tab toggle for sides; do not optimise for it now, but no fixed `width: 1100px`-style hostile values.

**Spacing:** 4/8/12/16/24/32/48 px scale. Outer page padding 32px desktop. Panel gutter 24px. Inside-panel padding 24px. Gap between cards in a panel 12px.

**Wireframe (desktop, ~1440px viewport):**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ◆ TRADEDESK                                                            BETA │
│  Build, execute, and review trades.                                          │
│  Trades are off-platform — given cards leave your portfolio, received cards  │
│  arrive into it.                                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────┐         ┌────────────────────────────┐      │
│  │  YOUR SIDE         (3)     │         │  THEIR SIDE        (2)     │      │
│  │  ───────────────────       │         │  ───────────────────       │      │
│  │  ⌕ Search portfolio…       │         │  PSA cert # ____  [Look up]│      │
│  │                            │         │  or [+ Add manually]       │      │
│  │  ┌────────┐  ┌────────┐    │         │  ┌────────┐  ┌────────┐    │      │
│  │  │ thumb  │  │ thumb  │    │         │  │ thumb  │  │ thumb  │    │      │
│  │  │ name   │  │ name   │    │  ┌───┐  │  │ name   │  │ name   │    │      │
│  │  │ year   │  │ year   │    │  │ ⇄ │  │  │ year   │  │ year   │    │      │
│  │  │ PSA 9  │  │ PSA 10 │    │  │   │  │  │ PSA 9  │  │ PSA 8  │    │      │
│  │  │ $480   │  │ $1,240 │    │  │NET│  │  │ $720   │  │ $310   │    │      │
│  │  └────────┘  └────────┘    │  │ ▲ │  │  └────────┘  └────────┘    │      │
│  │  ┌────────┐                │  │+340│ │                            │      │
│  │  │ thumb  │                │  └───┘  │                            │      │
│  │  │ name…  │                │         │                            │      │
│  │  └────────┘                │         │                            │      │
│  │                            │         │                            │      │
│  │  + Cash adding   $    0.00 │         │  + Cash receiving $    0.00│      │
│  │                            │         │                            │      │
│  │  ───────────────────       │         │  ───────────────────       │      │
│  │  Side total      $1,940.00 │         │  Side total      $1,030.00 │      │
│  └────────────────────────────┘         └────────────────────────────┘      │
│                                                                              │
│            [ ✦ Analyze with Claude AI ]    [ ◆ Execute Trade  → ]            │
│                                                                              │
│ ── only when phase === "pending" — slides up below canvas ──────────────── ▼ │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  COST BASIS ALLOCATION             pending — cancel-able             │    │
│  │  ──────────────────────                                              │    │
│  │  Total cost basis  $1,800.00   Allocated  $1,800.00   Remaining $0.00│    │
│  │  [Reset to even split]                                               │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐    │    │
│  │  │ [thumb]  Player A · 2018 · PSA 9     auto   $   900.00 [✎] │    │    │
│  │  │ [thumb]  Player B · 2021 · PSA 8     manual $   900.00 [↺] │    │    │
│  │  └──────────────────────────────────────────────────────────────┘    │    │
│  │                                                                      │    │
│  │  [ ← Cancel & edit trade ]              [ ✓  Confirm Trade ]         │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  PAST TRADES                                                                 │
│  ┌───────────────────────────────────────────────────────────────────┐      │
│  │  May 9 · 3 given · 2 received · ▲ +$340                           │      │
│  │  May 4 · 1 given · 1 received · ▼ −$120                           │      │
│  └───────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**What's not shown** (and why):

| Removed from current TradeTab | Why |
|---|---|
| Full-screen "animating" overlay (cards crossing centre + check-circle "Trade Executed!") | Replaced by inline phase transition. Trade-execution feedback is the allocation panel sliding in beneath the canvas + Net Delta chip pulsing once. The cross-paths overlay is theatre; the inline reveal is information. |
| `allocating`-step full-screen replacement of the canvas | Inline allocation keeps the canvas visible (read-only) — the user always knows what they're allocating against, and the canvas IS the answer to "what does this trade look like". |
| `Trade Value Difference` row underneath the summary bar (`+$X in your favor` text chip) | Folded into the central Net Delta chip — same number, more legible position. |
| Two separate Total summary panels at bottom of building view | Folded into per-panel `Side total` rows + central Net Delta chip. The current "summaryBar" duplicates info that's already in each column. |
| `Trading: 3 cards + $X` / `Receiving: 2 cards + $X` text chips | Side header counter + `Side total` row carries the same info more compactly. |

**What stays:**

- Symmetric panels (existing pattern) — restyled, same conceptual split.
- Cash-adding / cash-receiving rows — moved inside each panel (currently they're inside but compete for visual weight with the search/lookup row).
- Search input on Your Side, cert-lookup input on Their Side — same affordances.
- Past Trades section beneath canvas.
- Analyze with Claude AI as an explicit button (not auto-run).
- Pre-flight ConfirmModal before final cost-allocation submission.

---

## 3. State Shape

TypeScript-style notation; actual code is JSX. **Bold** entries are *new vs. current TradeTab*. Plain entries are preserved verbatim or near-verbatim from existing state.

```ts
// ── Lifecycle ──────────────────────────────────────────────
type Phase =
  | "building"      // canvas editable, no trade row exists yet
  | "executing"    // POST /trades/execute in flight (button spinner)
  | "pending"       // server returned tradeId; canvas read-only;
                    //   inline allocation panel visible
  | "confirming"   // POST /trades/confirm-cost in flight
  | "cancelling";  // POST /trades/cancel in flight (Back button)

// ── Building state — every entry below survives into pending ──
selectedIds:    Set<UUID>;                         // PRESERVED
receivedCards:  PsaCardLookup[];                   // PRESERVED — shape from lookupPsaCert
searchTerm:     string;                            // PRESERVED
certInput:      string;                            // PRESERVED
cashGiven:      string;                            // PRESERVED (raw input string)
cashReceived:   string;                            // PRESERVED

pricingByCert: Record<CertNumber, {                // PRESERVED
  status: "loading" | "loaded" | "unavailable";
  avgSalePrice?: number;
  cardhedgerImageUrl?: string | null;
}>;

// ── PSA lookup feedback ───────────────────────────────────
lookupLoading:  boolean;                           // PRESERVED — single-flight; no per-slot
lookupError:    string | null;                     // PRESERVED

// ── Trade-execution state ─────────────────────────────────
phase:          Phase;                             // **NEW — replaces step + executing + cancelling + confirming flags**
executeError:   string | null;                     // PRESERVED
tradeId:        UUID | null;                       // PRESERVED
persistedReceived: Array<                          // PRESERVED
  PsaCardLookup & { id: UUID }
>;

// ── Inline allocation ─────────────────────────────────────
allocations: Record<CertNumber, {                  // **NEW shape — currently `Record<CertNumber, string>`**
  mode:  "auto" | "manual";                        // "auto" rows participate in even-split rebalancing
  value: string;                                   // raw input value, same as today
}>;
confirmError:    string | null;                    // PRESERVED
showConfirmModal: boolean;                         // PRESERVED — pre-flight "no undo" warning

// ── Claude AI analysis (optional) ─────────────────────────
analysis: {                                        // **NEW grouped shape — replaces 4 separate flags**
  status:  "idle" | "loading" | "loaded" | "error";
  result:  AnalysisResult | null;
  error:   string | null;
  showResultModal: boolean;
  cancelledByExecute: boolean;                     // OQ-4: true when an in-flight analysis was
                                                   // cancelled by Execute. Drives a muted note in
                                                   // InlineAllocationPanel during pending phase only;
                                                   // cleared on phase === "executed".
};
```

**State slices preserved verbatim from current TradeTab:** `selectedIds`, `receivedCards`, `searchTerm`, `certInput`, `cashGiven`, `cashReceived`, `pricingByCert`, `lookupLoading`, `lookupError`, `tradeId`, `persistedReceived`, `executeError`, `confirmError`, `showConfirmModal`.

**State slices changed:**
- `step` (4 values) + `executing` + `cancelling` + `confirming` flags → single `phase` enum with 5 values. Removes the impossible-state surface area (e.g. `executing && step === "allocating"`).
- `allocations: Record<cert, string>` → `allocations: Record<cert, { mode, value }>` to support smart re-rebalancing of auto rows when the user manually overrides one cert. Default mode is `"auto"`; user clicking the override pencil flips it to `"manual"`. "Reset to even split" sets every row back to `"auto"` and recomputes.
- `overlayExiting` removed (no overlay).
- 4 analysis flags grouped into single `analysis` object.

---

## 4. Component Breakdown

```
TradeDeskPage                                  REUSE — light tweaks (eyebrow + dot palette → MASTER.md tokens)
└── TradeCanvas                                NEW — root for the redesigned canvas; owns phase + all state above
    ├── TradeCanvasHeader                      NEW — eyebrow + h1 + lead paragraph
    ├── TradeFloor                             NEW — flex row of [LeftPanel, NetDeltaChip, RightPanel]
    │   ├── TradePanel side="your"             NEW — symmetric panel, side prop drives label/affordances
    │   │   ├── PortfolioPicker                NEW — search + scrollable tradable-card grid; tap-to-add
    │   │   ├── TradedCardChip[]               NEW — symmetric chip used on BOTH sides; replaces ReceivedCardTile
    │   │   ├── CashRow                        NEW — extracted from inline cashRow markup in current TradeTab
    │   │   └── PanelTotal                     NEW — side total + card count
    │   ├── NetDeltaChip                       NEW — central; gold-tint frame, ▲/▼ + tween value
    │   └── TradePanel side="their"            NEW — same component, props drive: PSA cert input + add-manually
    │       ├── PsaCertInput                   NEW — extracted lookup input + button + error
    │       ├── ManualEntryDrawer              NEW — fallback for cards without a PSA cert (see §9 OQ-3)
    │       ├── TradedCardChip[]               NEW
    │       ├── CashRow                        NEW
    │       └── PanelTotal                     NEW
    ├── TradeActionBar                         NEW — Analyze + Execute buttons; collapses to "executing…" state
    ├── InlineAllocationPanel                  NEW — slides in below canvas when phase === "pending"
    │   ├── AllocationTotalsBar                NEW — total / allocated / remaining + "Reset to even split"
    │   ├── AllocationRow[]                    NEW — thumb + meta + auto/manual badge + value input + reset arrow
    │   └── AllocationActionBar                NEW — Cancel & edit (left) + Confirm Trade (right)
    ├── PreFlightConfirmModal                  REUSE — existing ConfirmModal from TradeTab.jsx, restyled
    └── ClaudeAnalysisModal                    REUSE — existing AnalysisLoadingModal + AnalysisModal,
                                                       restyled to MASTER.md tokens

PastTradesSection                              REUSE — existing TradeHistory + TradeHistoryRow +
                                                       TradeDetailColumn; restyled to MASTER.md tokens
```

**Component prop sketches (one-liners):**

| Component | Props |
|---|---|
| `TradeCanvas` | `{ cards, pastTrades, historyLoading, historyError, onTradeComplete }` (same surface as current `TradeTab`) |
| `TradePanel` | `{ side: "your"\|"their", phase, cards, total, cashValue, onCashChange, children }` |
| `PortfolioPicker` | `{ cards, selectedIds, searchTerm, onSearchChange, onToggle, disabled }` |
| `PsaCertInput` | `{ value, onChange, onLookup, loading, error, disabled }` |
| `TradedCardChip` | `{ card, side, valueLabel, onRemove, disabled }` (`disabled` is true in pending phase — no remove button) |
| `NetDeltaChip` | `{ givenSideTotal, receivedSideTotal, anyLoading }` |
| `InlineAllocationPanel` | `{ totalCostBasis, allocations, persistedReceived, error, onChange, onResetEven, onCancel, onConfirm, confirmDisabled, cancelling, confirming }` |

**Reused with light restyling:** `ConfirmModal`, `AnalysisLoadingModal`, `AnalysisModal`, `TradeHistory`, `TradeHistoryRow`, `TradeDetailColumn`, `TradeGivenScroller` (becomes `PortfolioPicker`'s scroll behaviour).

**Reused verbatim:** `computeTradeCostBasis()` from `utils/trade.js`, `isSold`/`isTraded` from `utils/portfolio.js`, `isTradableCard()` filter from current TradeTab.

**InlineAllocationPanel additional behavior (OQ-4).** When `analysis.cancelledByExecute === true`, the panel renders a muted single-line note at the very top, above `AllocationTotalsBar`: *"Analysis was cancelled when the trade executed."* This note is scoped to `phase === "pending"` only — it disappears at `phase === "executed"` and never persists into trade history.

---

## 5. Interaction Flows

### Flow A — Building a standard trade (cards on both sides)

1. User lands on `/tradedesk`. `TradeDeskPage` fetches `getCards()` + `listTrades()` in parallel; spinner shows during fetch.
2. Canvas mounts in `phase: "building"`. Both panels are empty. Net Delta chip reads "—" in muted grey. Execute button disabled with helper text "Add at least one card to either side to execute" (relaxed from current "must have at least one on each").
3. User scans / searches portfolio in the left panel via `PortfolioPicker`. Each tap toggles `selectedIds` membership; the tapped card animates from the picker grid into a `TradedCardChip` slot in *Your Side* (see §6 card-arrival flourish). Side total tweens. Net Delta tweens.
4. User clicks PSA cert input on right, types cert, hits Enter. `PsaCertInput` fires `lookupPsaCert(cert)`; on success the returned PSA payload is appended to `receivedCards`; the chip materializes into *Their Side* via the same arrival animation. Pricing fetch fires in the background; tile shows shimmering value placeholder until pricing resolves, then tweens to the final value.
5. User adds cash on either side via `CashRow`. Side total + Net Delta chip tween.
6. User optionally clicks **Analyze with Claude AI** → `ClaudeAnalysisModal` opens with progress, displays verdict on completion. Result is cached in `analysis.result`. Modifying either side invalidates the cached analysis (button label reverts to "Analyze Trade"). Same invalidation rule as today.
7. User clicks **Execute Trade** → phase flips to `"executing"` (button shows spinner). `executeTrade(payload)` lands. On success, phase flips to `"pending"`, server-issued `tradeId` + `persistedReceived` populate state, allocations seed to `{mode:"auto", value: <even-split>}` for every received cert. Canvas dims to read-only (no remove buttons; cash inputs disabled). InlineAllocationPanel slides up beneath. **OQ-4 edge case:** if `analysis.status === "loading"` at Execute time, the analysis modal closes silently, the in-flight request's result is discarded, and `analysis.cancelledByExecute` flips to `true` — the InlineAllocationPanel surfaces a muted *"Analysis was cancelled when the trade executed."* note above `AllocationTotalsBar` after slide-up. Pending phase only; cleared on `phase === "executed"`.
8. User reviews even-split allocation, optionally overrides a row (see Flow D). Hits **Confirm Trade** → ConfirmModal opens with summary; user clicks "Confirm" inside the modal. Phase → `"confirming"`. `confirmTradeCost()` lands. On success, post-pricing `refreshPortfolio({cardIds: newCardIds})` runs (best-effort; failures swallowed). `onTradeComplete(newCardIds)` navigates to `/portfolio?tab=collection&pulse=<ids>`.

### Flow B — Pure acquisition (no given cards, cash given, receive a card)

1. Same as A.1–A.2, but user does *not* tap any cards on Your Side.
2. User adds cash via Your Side's `CashRow` (e.g. $200) — the side total reflects pure cash.
3. User looks up a PSA cert on Their Side; chip materializes; pricing populates.
4. Net Delta now reads `▲ +$X in your favor` if pricing > cash, else `▼ −$X` if cash > pricing.
5. **Execute is enabled** (relaxed from current rule that required cards on both sides). Helper text under Execute reads "Pure-acquisition trade — Your Side has no cards, only cash."
6. `executeTrade()` is called with `cardsGiven: []`, `cashGiven: 200`, `cardsReceived: [...]`. Backend already supports this (`execute-trade.js:44-46` only requires "at least one card on either side").
7. After server returns `pending`, allocation panel slides in. Total cost basis = `0 - cashReceived + cashGiven = $200` (per `computeTradeCostBasis`). Even-split distributes $200 across received cards.
8. Confirm proceeds as in Flow A.

### Flow C — Cancelling a pending trade

1. From `phase: "pending"`, user clicks **Cancel & edit trade** in the AllocationActionBar.
2. Phase → `"cancelling"` — the Cancel button shows "Cancelling…", Confirm Trade disables, `disabled` prop on TradedCardChips stays true.
3. `cancelTrade(tradeId)` lands.
4. On success: `tradeId` clears, `persistedReceived` clears, `allocations` clears, phase → `"building"`. The Inline Allocation Panel slides down and unmounts. Canvas re-enables — the user's `selectedIds`, `receivedCards`, `pricingByCert`, `cashGiven`, `cashReceived` are intact (preserved local state) so they can edit and re-execute without rebuilding the trade from scratch.
5. On failure (network, race with double-confirm, etc.): the cancel error displays in a red bar at the top of the allocation panel; phase stays `"pending"` so the user can retry.

### Flow D — Allocating costs inline and confirming (pending → executed)

1. Phase is `"pending"`. AllocationPanel is visible. Each row shows `[thumb] [name + meta] [auto badge] [$X.XX value input] [reset arrow ↺]`. Default state: every row is `mode: "auto"`, value = even-split share. AllocationTotalsBar reads `Total $X.XX  Allocated $X.XX  Remaining $0.00`.
2. User wants to override one card's allocation (e.g. weight a hit card heavier). They click the value input and type a new amount. As soon as they type, that row flips `mode → "manual"`, badge changes from "auto" to "manual", the reset arrow ↺ appears.
3. The remaining `mode: "auto"` rows automatically rebalance: `(totalCostBasis - sum(manual rows)) / count(auto rows)`. AllocationTotalsBar's "Allocated" tween updates; "Remaining" stays at $0.00 if rebalancing distributes cleanly.
4. If the user types an over-allocation (manual rows sum > totalCostBasis), auto rows clamp to $0.00, "Remaining" goes negative and turns red `#f87171` with an "Over by $X" label — Confirm Trade disables.
5. User clicks ↺ on a manual row → row flips back to `"auto"`, value re-derives from current rebalancing pass.
6. **Reset to even split** in the totals bar resets every row to `mode: "auto"` and recomputes from scratch.
7. When `Math.abs(remaining) < 0.01`, Confirm Trade enables (gold tint enables on hover). User clicks → ConfirmModal opens with: card thumbs from both sides, net cash flow line, "This action cannot be undone" warning. User clicks Confirm inside the modal → phase → `"confirming"` → `confirmTradeCost(payload)` → success → navigation per Flow A.8.

### Flow E — Attempting to add a consignment-pending card and being told why it can't be traded

1. User is searching the portfolio in the left panel. The `PortfolioPicker` already filters via `isTradableCard()`, which excludes any card where `consignmentStatus ∈ {"pending", "in_review", "listed"}` or `isSold(card)` or `isTraded(card)`. So consignment-pending cards do not appear in the picker grid by default.
2. **Edge case** — user has a card open in CardModal elsewhere with a "Trade this card" button (future surface, not in this redesign), and arrives at TradeDesk with that card's id pre-selected via deep link. If the card is in a non-tradable state, the canvas detects this on mount and shows an inline banner above the left panel: "*<Player Name>* is currently consigned (status: in_review) and can't be traded. [View consignment →]" with a button to navigate to the consignment surface. The card is *not* added to selectedIds.
3. **Edge case** — user added a card while it was tradable, then a background pricing refresh updated `consignmentStatus`. On next render, `selectedIds` may contain a now-non-tradable id. Mitigation: after every `cards` prop change, run `selectedIds = selectedIds.intersection(tradableCards.map(id))`. If a card was removed, surface a one-time toast: "*<Player Name>* was removed from this trade — its consignment status changed."

---

## 6. Animation Spec

| Trigger | What animates | Duration | Easing | On complete |
|---|---|---|---|---|
| **Card arrives on Your Side** (user taps card in PortfolioPicker) | Source picker tile fades to 30% opacity in place. A clone of the tile lifts (translateY −12px, scale 1.04) over 150ms, then transits along a curved path to the empty TradedCardChip slot in *Your Side*. Settles with a brief overshoot (scale 1.06 → 1.0) and a soft 200ms gold-tint pulse on the chip frame. | 600ms total (150 lift + 300 transit + 150 settle) | Lift: ease-out cubic. Transit: cubic-bezier(0.4, 0.0, 0.2, 1) (Material standard). Settle: spring-ish (overshoot then ease) | Source picker tile is replaced by an "added" state (greyed checkmark), totals tween starts. |
| **Card arrives on Their Side** (PSA lookup resolves) | Empty placeholder slot appears with a 150ms scale-in (0.92 → 1.0) and opacity 0→1. Card image populates with a 200ms fade once the URL resolves. Soft 200ms gold-tint pulse on the chip frame. | 350ms total (no transit; the card "materializes" — there's no source to transit *from*, since it came from outside the screen) | Scale-in: ease-out cubic. Pulse: ease-in-out | Pricing-fetch shimmer starts on the value field. |
| **Side total tween** | Numeric value smoothly counts from prev → next (e.g. $1,600 → $1,940 over ~400ms). | 400ms | ease-out | Settles to final value. |
| **Net Delta chip tween** | Numeric value tweens; chip border-tint cross-fades between gold-tint (positive), red-tint (negative), and grey-tint (neutral) as the sign changes. ▲/▼ icon swaps with a 100ms cross-fade if the sign changes. | 400ms | ease-out | — |
| **Pricing-fetch shimmer** | 120-degree linear-gradient sweep across the value field while pricing is loading. | Loop, 1.4s per pass | linear | Stops when status flips off "loading". |
| **Phase transition: building → pending** | Canvas dims via opacity 1.0 → 0.6 over 200ms; remove buttons fade out. InlineAllocationPanel slides up from below (translateY 24px → 0, opacity 0 → 1) over 350ms with a 100ms stagger after the dim starts. NetDeltaChip pulses once (gold flash, 250ms). | 450ms total | Dim: ease-out. Slide: cubic-bezier(0.0, 0.0, 0.2, 1) (decelerate). Pulse: ease-in-out | Allocation panel takes focus (first input). |
| **Phase transition: pending → building** (cancel) | Reverse of above: allocation panel slides down (translateY 0 → 24px, opacity 1 → 0) over 250ms, canvas opacity 0.6 → 1.0 over 200ms. Slightly faster than enter (per MASTER motion: exit shorter than enter). | 250ms | accelerate cubic-bezier(0.4, 0.0, 1.0, 1.0) | Canvas re-enables, focus returns to last-touched input. |
| **Phase transition: pending → executed** | Allocation panel + canvas fade out together (opacity → 0) over 200ms before navigation away. No celebratory check overlay (removed from current flow). The pulse-on-arrival on the destination /portfolio page (existing behaviour via `?pulse=<ids>`) carries the celebratory beat. | 200ms | ease-in | Navigate to /portfolio. |
| **Hover on TradedCardChip remove button** | Button opacity 0 → 1, scale 0.9 → 1.0. | 120ms | ease-out | — |
| **Hover on Execute / Confirm buttons** | Background brightens, scale 1.0 → 1.02. | 100ms | ease-out | — |
| **Allocation row override → manual** | Auto/manual badge cross-fades, ↺ reset icon scale-in (0.6 → 1.0). | 200ms | ease-out | — |

**ONE deliberate spatial flourish:** the "card arrives in panel" choreography. Everything else is sub-300ms micro-motion that exists to express cause/effect, not to entertain.

**Things explicitly NOT animated** (so we don't drift):
- Section headers, eyebrows, paragraph text — static.
- Search input typing.
- Cash input typing — value just updates; no count-up tween on the input itself (the side total tween is enough downstream feedback).
- Past Trades rows.
- Background gradient or page chrome — no parallax, no ambient motion.
- The auto/manual rebalance — values update instantly to keep it computational, not flashy. (The exception is the *Allocated* total in the totals bar, which tweens.)

---

## 7. Design System Application

All tokens pulled directly from `MASTER.md`. **`utils/theme.js` is intentionally bypassed** — it still carries the legacy `#f59e0b` gold and the gold-panel gradients, neither of which match Editorial Dark. Inlining MASTER.md tokens directly keeps the redesign clean of the drift; theme.js will be reconciled separately (see §9 OQ-6).

**Post-prerequisite update.** Once the OQ-6 theme.js reconciliation lands on master and this branch rebases, redesign components MAY consume the reconciled `theme.js` tokens (`colors.gold` will be antique `#d4af37`, `gradients.goldPanel` will reflect Editorial Dark) instead of inlining MASTER.md tokens. Until that rebase, MASTER.md tokens stay inlined per the table below.

| Surface / element | Token | Hex |
|---|---|---|
| Page background | `bg-base` | `#0a0e1a` |
| TradePanel background | `surface-1` | `#0f172a` |
| TradedCardChip background | `surface-2` | `#1a2332` |
| TradedCardChip hover | `surface-2` + 4% white wash | mix |
| InlineAllocationPanel background | `surface-1` (slightly lifted via subtle hairline top edge to read as a sibling layer) | `#0f172a` |
| ConfirmModal background | `surface-2` | `#1a2332` |
| Hairlines (between panels, between rows, around chips) | `hairline` | `rgba(255,255,255,0.06)` |
| TradedCardChip border (default) | `hairline` | same |
| TradedCardChip border (just-arrived pulse) | `gold-tint` | `rgba(212,175,55,0.08)` for 200ms then back to hairline |
| Net Delta chip border (gold accent — see Three Rules below) | `gold-primary` at 30% alpha | `rgba(212,175,55,0.3)` |
| Net Delta chip background tint (positive) | `gold-tint` | `rgba(212,175,55,0.08)` |
| Net Delta chip background tint (negative) | `loss-bg` | `rgba(248,113,113,0.10)` |
| Net Delta chip background tint (parity) | `surface-2` | `#1a2332` |
| Primary CTA (Execute, Confirm) background | `text-primary` | `#f8fafc` (white-on-dark per gold-scarcity rule — gold goes to Net Delta only) |
| Primary CTA text | `bg-base` | `#0a0e1a` |
| Secondary CTA (Analyze, Cancel & edit, Reset to even split) | transparent + 1px hairline border | — |
| Disabled CTA | `surface-2`, text-color `text-subtle` | `#1a2332` / `#64748b` |
| Body text | `text-secondary` | `#cbd5e1` |
| Headings | `text-primary` | `#f8fafc` |
| Muted labels (column headers, "Cash adding") | `text-muted` | `#94a3b8` |
| Eyebrow text + dot | `gold-primary` | `#d4af37` |
| Gain (▲ deltas) | `gain` | `#34d399` |
| Loss (▼ deltas) | `loss` | `#f87171` |
| Info (rare; e.g. "pending — cancel-able" tag) | `info` | `#60a5fa` |

### Inter Display (opsz 32) numerics

Every number that "sits" rather than scrolls past — i.e. anchors the user's attention — gets `font-family: 'Inter', sans-serif` with `font-variation-settings: "'opsz' 32"`:

- Side totals (per-panel)
- Net Delta value
- Total cost basis / Allocated / Remaining (allocation totals bar)
- Per-card values inside TradedCardChip
- Cash row values (the `$X.XX` rendered, not the input itself)

### Tabular figures (`font-variant-numeric: tabular-nums`) — required everywhere numbers stack or could change

- Per-card values inside chips (so a $1,200 card sitting next to a $480 card aligns its decimals)
- Side totals
- Net Delta value
- Allocation row value inputs (so $900.00 next to $1,200.00 doesn't jitter on tween)
- Allocation totals bar
- Past Trades summary numbers

### Gold scarcity — deliberate placement

**Single role: Net Delta chip.** Gold border at 30% alpha + gold-tint background when the trade favors the user. This is the single most important number on the screen — it's *the* answer to "should I do this trade?" Gold here means "this is the weighted-with-meaning number." Everywhere else stays white/slate; primary CTAs (Execute, Confirm) use `text-primary` (white) on `bg-base` (near-black), per MASTER §3.2.

The eyebrow ("◆ TRADEDESK") + dot at the top of the page also use gold, but that's the brand-mark eyebrow pattern shared with every other page in the app — not new gold consumption. Eyebrows are a globally-consumed gold slot, separate from the per-screen scarcity rule.

### Gain/loss with icons (MASTER §3.3)

- Net Delta chip: `▲` for positive, `▼` for negative, no icon at parity.
- Past Trades rows: `▲ +$340` / `▼ −$120` (existing pattern, reused).
- Allocation "Over by $X" warning: red text + `▼` icon to be consistent.

### Deviations from MASTER.md

None planned. If implementation forces any, document inline in code with a `// MASTER deviation:` comment and surface in the phase 2 PR description.

---

## 8. Preserved Backend Contracts

All three trade Lambdas keep their wire format. The redesign is pure UI; no Lambda touches.

| Frontend call | Endpoint | Payload | Response |
|---|---|---|---|
| `executeTrade(payload)` | POST `/trades/execute` | `{ cardsGiven: UUID[], cardsReceived: PsaCardLookup[], cashGiven: number, cashReceived: number, notes?: string }` | `{ tradeId: UUID, receivedCards: [{ id, certNumber }] }` |
| `confirmTradeCost(payload)` | POST `/trades/confirm-cost` | `{ tradeId: UUID, allocations: [{ certNumber: string, cost: number }] }` | `{ ok: true, tradeId }` |
| `cancelTrade(tradeId)` | POST `/trades/cancel` | `{ tradeId: UUID }` | `{ ok: true, restored: number, deleted: number }` |
| `analyzeTrade(payload)` | POST `/trades/analyze` | (unchanged from current TradeTab.handleAnalyze) | `AnalysisResult` |
| `lookupPsaCert(cert)` | GET `/psa/lookup?cert=…` | — | `PsaCardLookup` |
| `previewPricing(psa)` | POST `/pricing/preview` | (unchanged) | `{ available, avgSalePrice, cardhedgerImageUrl }` |
| `refreshPortfolio({ cardIds })` | POST `/cards/refresh` | (unchanged) | best-effort; non-fatal on failure |
| `listTrades()` | GET `/trades` | — | `Trade[]` (executed only) |

**Specific shapes the new components need to emit unchanged:**

- `cardsReceived` array entries must carry every field the current `handleExecute` snapshots: `certNumber`, `playerName`, `year`, `brand`, `grade`, `sport`, `cardNumber`, `gradeDescription`, `frontImageUrl`, `backImageUrl`, `psaPopulation`, `psaPopulationHigher`, `psaData`, `estimatedValue` (from pricing). The new `PsaLookup` component must persist all these fields after lookup, not strip them. (Reference: `execute-trade.js:99-133` reads them all.)

- `allocations` array entries must be `{ certNumber, cost }` where `cost = parseFloat(allocations[cert].value) || 0`. The new `{mode, value}` shape is purely a frontend construct — flatten before posting.

- Pre-flight `ConfirmModal` opens before `confirmTradeCost`, never around any other call. Existing semantics — preserved.

**Backend changes flagged but NOT proposed in this phase:**

- *(Flagged only.)* If the redesign ever wants to support a "Save draft" — i.e. a trade row that exists in DB without inventory mutation — that'd require a new `trades.status` value or a new endpoint. **Not in scope here.** The current pending status conflates "executed but cost-unconfirmed" with "draft", and that's acceptable for v1.

- *(Flagged only.)* Manual entry on Their Side (cards with no PSA cert — see §9 OQ-3) would need either a relaxation of the `isValidCertNumber` validator on the backend or a separate endpoint that accepts arbitrary card metadata without a cert. Decision deferred.

---

## 9. Resolved Decisions

All 8 open questions resolved on **2026-05-11**. Each row records the call and the reasoning so future sessions don't re-litigate.

| # | Decision | Reasoning |
|---|---|---|
| **OQ-1** ✓ RESOLVED 2026-05-11 | **Net Delta chip — permanent gold border; internal fill shifts.** Border stays `gold-primary` at 30% alpha at all times. Fill shifts: `gold-tint` for positive delta, `loss-bg` for negative, `surface-2` for parity. ▲/▼ icon swaps on sign change as previously specified. | Reads as "this is the score" — the chrome anchors the chip's role on the screen, the inner fill carries the news. |
| **OQ-2** ✓ RESOLVED 2026-05-11 | **Relax pure-acquisition Execute validator.** Frontend `canExecute` becomes "at least one item (card OR cash) on the giving side AND at least one card on the receiving side." Helper text "Pure-acquisition trade — Your Side has no cards, only cash." surfaces beneath Execute when `givenCards.length === 0`. | Backend already accepts `cardsGiven: []` (per `execute-trade.js:44-46`). The brief confirms pure-acquisition is a first-class flow; the frontend gate was the only blocker. |
| **OQ-3** ✓ RESOLVED 2026-05-11 | **Manual entry: button visible but disabled, with tooltip.** `[+ Add manually]` renders in *Their Side* under the PSA cert input, disabled, with a tooltip reading "Coming soon — phase 2 is PSA-cert only." | Telegraphs the future capability without taking on the backend complexity (cert_number nullability, payload-shape divergence) yet. Disabled-with-affordance beats hidden-and-surprising. |
| **OQ-4** ✓ RESOLVED 2026-05-11 | **Execute mid-analysis: silently close the analysis modal, surface a scoped acknowledgment.** The in-flight Claude request is cancelled (modal closes, `analysis.result` discarded), and `analysis.cancelledByExecute` flips to `true`. The InlineAllocationPanel renders a muted single-line note above `AllocationTotalsBar`: *"Analysis was cancelled when the trade executed."* The note is scoped to `phase === "pending"` only — it disappears at `phase === "executed"` and never persists into trade history. State touched: §3 (added `cancelledByExecute` to `analysis` shape), §4 (InlineAllocationPanel behavior bullet), §5 Flow A.7 (edge-case append). | Telling the user *why* the modal vanished respects their attention. Re-running analysis post-trade is meaningless (the trade is committed), so the note deliberately doesn't suggest it. Scoping to pending phase keeps the note from polluting trade history. |
| **OQ-5** ✓ RESOLVED 2026-05-11 | **Empty-state copy: keep current.** Your Side empty: *"Tap cards from your portfolio to add them here."* Their Side empty: *"Look up PSA certs above to add cards."* Net Delta chip empty: `—`. | Functional copy ships first; iterate after a real user touches it. Inventing voice in a vacuum produces hollow lines. |
| **OQ-6** ✓ RESOLVED 2026-05-11 | **`utils/theme.js` reconciliation lands on MASTER, not on this branch. Then this branch rebases onto master.** Reconciliation is a prerequisite to the TradeDesk implementation, tracked in a separate session. After rebase, redesign components MAY consume the new tokens; until then, MASTER.md tokens stay inlined per §7. §10 implementation sequence renumbered to drop the in-branch reconciliation step and add a prereq line to the preamble. | Master is the right home for design-system token changes — the theme.js diff touches 7+ pages outside TradeDesk and shouldn't ride a feature branch. Rebase keeps the redesign-branch history linear once it lands. |
| **OQ-7** ✓ RESOLVED 2026-05-11 | **Match current allocation behavior.** Confirm Trade enables when `Math.abs(remaining) < 0.01`, regardless of mode mix. No auto-flip-back if every row goes manual — the user manages it. | The Remaining $0.00 gate is a sufficient signal. "Smart" auto-flip behavior takes control from the user and is harder to reason about than predictable math. |
| **OQ-8** ✓ RESOLVED 2026-05-11 | **Surface Net Delta as muted context inside the allocation panel.** A small `Net Delta: ▲ +$340` line appears above the AllocationTotalsBar at `text-muted` weight. Read-only. | The pending-phase canvas is dimmed; this preserves "why am I allocating *this much*?" without re-anchoring focus on a number that's no longer actionable. |

---

## 10. Implementation Sequence (Phase 2 build order)

Each step is independently shippable. ⏵ marks parallel-safe; ⏸ marks sequence-locked on a prior step.

**Prerequisite (lands on master before this branch resumes):** `utils/theme.js` reconciliation per OQ-6. Tracked in a separate session on master; the redesign branch rebases onto master once it lands. Not part of the table below.

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | ⏵ **Extract `PreFlightConfirmModal`, `ClaudeAnalysisModal`, `PastTradesSection`** from current TradeTab.jsx into their own files. Pure refactor — current TradeTab keeps working. | Small | — |
| 2 | ⏵ **Add `tradedesk-redesign-plan.md`** (this file). | Small (done) | — |
| 3 | ⏸ **Build `TradeCanvas` skeleton** — phase state machine, header, empty `TradeFloor` with two empty `TradePanel`s and a `NetDeltaChip` placeholder. Mounts at a feature-flag-gated `/tradedesk-v2` route so the existing `/tradedesk` keeps working. | Medium | prereq (theme.js on master + rebase) |
| 4 | ⏸ **Build `PortfolioPicker`** — search + filtered list using `isTradableCard`, tap-to-toggle. Plug into `selectedIds`. No animation yet. | Medium | 3 |
| 5 | ⏸ **Build `PsaCertInput`** — extracted from current handleLookup logic. Plug into `receivedCards` + `pricingByCert`. | Small | 3 |
| 6 | ⏸ **Build `TradedCardChip`** — symmetric chip with grade badge + value + remove button. Used on both sides. | Medium | 3 |
| 7 | ⏸ **Build `CashRow` + `PanelTotal`** — extract + restyle. Wire `cashGiven` / `cashReceived` + side totals. | Small | 6 |
| 8 | ⏸ **Build `NetDeltaChip`** — gold-bordered chip with ▲/▼ + value tween. Reactive on side totals + `pricingByCert` resolution. Permanent gold border per OQ-1; internal fill shifts gold-tint / loss-bg / surface-2 by sign. | Medium | 7 |
| 9 | ⏸ **Build `TradeActionBar`** — Analyze + Execute buttons. Wire to existing `handleAnalyze` + `handleExecute` (with the relaxed `canExecute` validator per OQ-2). Implements OQ-4 silent-cancel: setting `analysis.cancelledByExecute = true` if Execute fires while `analysis.status === "loading"`. | Small | 8 |
| 10 | ⏵ **Add card-arrival animation** — Your Side (transit from picker tile) + Their Side (materialize on lookup). Includes side-total + Net Delta tween. | Large | 8 |
| 11 | ⏸ **Build `InlineAllocationPanel`** — total/allocated/remaining bar, allocation rows with auto/manual mode + reset, Cancel & Confirm buttons. Wire to existing `confirmTradeCost` + `cancelTrade`. New `allocations: {mode, value}` state shape with rebalancing. Surfaces the OQ-4 cancellation note (scoped to pending phase) and the OQ-8 muted Net Delta context line. | Large | 9 |
| 12 | ⏸ **Build phase-transition animations** — building → pending slide-up, pending → building slide-down, pending → executed fade-out. Wire `phase` enum into transitions. | Medium | 11 |
| 13 | ⏵ **Restyle `PreFlightConfirmModal` + `ClaudeAnalysisModal` + `PastTradesSection`** to MASTER.md tokens (or to the reconciled `theme.js` tokens after the prereq lands). Pure visual; no logic. | Medium | 1, prereq |
| 14 | ⏸ **Wire `TradeDeskPage` to new `TradeCanvas`** — switch the import; remove the v1 TradeTab. Update `TradeDeskPage` eyebrow + dot to MASTER tokens. | Small | 3–13 |
| 15 | ⏸ **Delete legacy `TradeTab.jsx`** + the legacy `step` machine + the `TradeAnimationOverlay` overlay component + the `AnimThumbnail` component + their style block. Verify no other imports. | Small | 14 |
| 16 | ⏵ **Add unit tests** for `computeTradeCostBasis` edge cases the redesign exercises (pure acquisition, manual override rebalancing). | Small | 11 |
| 17 | ⏸ **Manual QA pass** in browser: build a standard trade, build pure-acquisition, cancel a pending, override allocation manually, hit allocation over-budget, watch every animation in slow-mo, then Cmd+R mid-pending and verify the recovery story. Document recovery story explicitly if not handled (probably the trade stays pending in DB and requires an admin nudge — flag it). | Medium | 15 |

**Estimated total scope:** ~3–5 working days for the full implementation if the scope above holds. Steps 3–12 are the meat (~70% of effort); steps 1–2 and 13–17 are mechanical.

---

*End of plan. Phase 2 implementation begins after human review of the open questions in §9.*
