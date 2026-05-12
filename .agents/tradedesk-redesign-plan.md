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

---

## 5. Interaction Flows

### Flow A — Building a standard trade (cards on both sides)

1. User lands on `/tradedesk`. `TradeDeskPage` fetches `getCards()` + `listTrades()` in parallel; spinner shows during fetch.
2. Canvas mounts in `phase: "building"`. Both panels are empty. Net Delta chip reads "—" in muted grey. Execute button disabled with helper text "Add at least one card to either side to execute" (relaxed from current "must have at least one on each").
3. User scans / searches portfolio in the left panel via `PortfolioPicker`. Each tap toggles `selectedIds` membership; the tapped card animates from the picker grid into a `TradedCardChip` slot in *Your Side* (see §6 card-arrival flourish). Side total tweens. Net Delta tweens.
4. User clicks PSA cert input on right, types cert, hits Enter. `PsaCertInput` fires `lookupPsaCert(cert)`; on success the returned PSA payload is appended to `receivedCards`; the chip materializes into *Their Side* via the same arrival animation. Pricing fetch fires in the background; tile shows shimmering value placeholder until pricing resolves, then tweens to the final value.
5. User adds cash on either side via `CashRow`. Side total + Net Delta chip tween.
6. User optionally clicks **Analyze with Claude AI** → `ClaudeAnalysisModal` opens with progress, displays verdict on completion. Result is cached in `analysis.result`. Modifying either side invalidates the cached analysis (button label reverts to "Analyze Trade"). Same invalidation rule as today.
7. User clicks **Execute Trade** → phase flips to `"executing"` (button shows spinner). `executeTrade(payload)` lands. On success, phase flips to `"pending"`, server-issued `tradeId` + `persistedReceived` populate state, allocations seed to `{mode:"auto", value: <even-split>}` for every received cert. Canvas dims to read-only (no remove buttons; cash inputs disabled). InlineAllocationPanel slides up beneath.
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

## 9. Open Questions for Human

| # | Question | Why it matters | Recommendation |
|---|---|---|---|
| **OQ-1** | **Gold placement on Net Delta chip — confirm.** Plan proposes gold border + gold-tint background when the trade is in the user's favor (positive delta). When neutral or negative, the chip drops gold and uses surface-2 (neutral) or loss-bg (negative). Acceptable, or should gold attach to the chip *frame* permanently and only the inner color shifts? | This is the single gold consumer on the page — getting it wrong means the whole "this trade is good for you" signal lands wrong. | Permanent gold border, *internal fill* shifts (gold-tint / loss-bg / neutral). Reads more "this is the score" and less "the score lit up the chrome." |
| **OQ-2** | **Pure-acquisition Execute button — relax the validator?** Current TradeTab requires both sides to have at least one card (`canExecute = ... && givenCards.length > 0 && receivedCards.length > 0`). Backend already accepts `cardsGiven: []`. Confirm we want to relax the frontend rule to "at least one item (card or cash) on the giving side, at least one card on the receiving side." | Pure-acquisition is a confirmed first-class flow per the brief. The frontend gate is the only thing blocking it today. | Yes, relax. Helper text "Pure-acquisition trade" surfaces beneath the Execute button when `givenCards.length === 0`. |
| **OQ-3** | **Manual entry for Their Side cards without a PSA cert.** A card show counterparty might offer a raw / SGC / BGS card whose cert isn't a PSA number. The brief mentions PSA lookup *or* manual entry; current TradeTab is PSA-only. Should manual entry be in scope for phase 2, or deferred? | If manual entry is in, the whole `cardsReceived` payload shape needs a "manual" flag (no PSA payload to snapshot) and the schema's `cert_number` needs nullable handling — which it already is for `trade_cards` but is NOT NULL on the `cards` table (`UNIQUE (user_id, cert_number)`). This is a real backend touch. | Defer manual entry to a follow-up phase. Phase 2 ships PSA-only, with the `[+ Add manually]` button stubbed and disabled with a "Coming soon" tooltip. |
| **OQ-4** | **What happens if the user clicks Execute while a Claude analysis request is in flight?** Current TradeTab allows it (independent buttons). Should Execute disable while `analysis.status === "loading"`, or just race? | If the analysis lands after Execute submits, the cached result is now meaningless — the trade is committed against an analysis the user didn't see. Confusing UX. | Execute does *not* disable; analysis modal closes itself silently if Execute is clicked mid-flight. The `analysis.result` is then discarded. Same behavior as today; just document it. |
| **OQ-5** | **Empty-state copy for both panels and the Net Delta chip.** Brief says "Don't invent answers." Three slots need copy I'm not going to write blindly: (a) Your Side empty: "Tap cards from your portfolio to add them here." (current) (b) Their Side empty: "Look up PSA certs above to add cards." (current) (c) Net Delta chip empty: currently "—". | Copy carries voice. The current copy is functional; ask if the redesign wants something more editorial ("Lay your first card to begin", etc.). | Keep current functional copy for v1; iterate after a real user touches it. |
| **OQ-6** | **`utils/theme.js` carries legacy `#f59e0b` gold and gold-panel gradients that don't match Editorial Dark.** Plan inlines MASTER.md tokens directly inside the redesign to bypass theme.js. Should phase 2 also reconcile theme.js (rename gold tokens to antique gold, rewrite gradients) — or is that a separate cleanup? | The whole codebase imports from theme.js. If we don't reconcile, the design-system drift persists and other pages keep diverging. If we do reconcile in phase 2, scope blows up. | Reconcile theme.js in a *separate* commit on this same branch *before* the TradeDesk implementation lands. Atomic, revertable, doesn't drag TradeDesk's own scope. |
| **OQ-7** | **Allocation auto-rebalancing behavior — what if the user manually overrides every row?** With every row in `manual` mode, there are no auto rows to absorb the remainder. Currently this state is just "the user manages it." Should the UI show "auto rows exhausted — Confirm enabled only when sum equals total" (same as today) or auto-flip the last manual row back to auto? | The latter is "smart" but takes control from the user. The former is what TradeTab does today (just relies on the Remaining $0.00 gate). | Match today's behavior — keep it dumb. Confirm enables when `Math.abs(remaining) < 0.01`, regardless of mode mix. |
| **OQ-8** | **Should the InlineAllocationPanel also show the central Net Delta chip's value as context?** The pending state hides the canvas (dimmed); the user sees Total Cost Basis but not "the trade was ▲ +$340 in your favor". | If yes, helps the user remember why they're allocating *this much*. If no, keeps the allocation panel focused on the math. | Yes — surface a small "Net Delta: ▲ +$340" line above the AllocationTotalsBar, at `text-muted` weight. Read-only context, not a re-anchor. |

---

## 10. Implementation Sequence (Phase 2 build order)

Each step is independently shippable. ⏵ marks parallel-safe; ⏸ marks sequence-locked on a prior step.

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | **Reconcile `utils/theme.js`** to MASTER.md tokens (antique gold; remove gold-panel gradients; introduce Editorial-Dark token exports). Search-and-replace across the codebase. Visual diff every page that imports it. | Medium | — |
| 2 | ⏵ **Extract `PreFlightConfirmModal`, `ClaudeAnalysisModal`, `PastTradesSection`** from current TradeTab.jsx into their own files. Pure refactor — current TradeTab keeps working. | Small | — |
| 3 | ⏵ **Add `tradedesk-redesign-plan.md`** (this file). | Small (done) | — |
| 4 | ⏸ **Build `TradeCanvas` skeleton** — phase state machine, header, empty `TradeFloor` with two empty `TradePanel`s and a `NetDeltaChip` placeholder. Mounts at a feature-flag-gated `/tradedesk-v2` route so the existing `/tradedesk` keeps working. | Medium | 1 |
| 5 | ⏸ **Build `PortfolioPicker`** — search + filtered list using `isTradableCard`, tap-to-toggle. Plug into `selectedIds`. No animation yet. | Medium | 4 |
| 6 | ⏸ **Build `PsaCertInput`** — extracted from current handleLookup logic. Plug into `receivedCards` + `pricingByCert`. | Small | 4 |
| 7 | ⏸ **Build `TradedCardChip`** — symmetric chip with grade badge + value + remove button. Used on both sides. | Medium | 4 |
| 8 | ⏸ **Build `CashRow` + `PanelTotal`** — extract + restyle. Wire `cashGiven` / `cashReceived` + side totals. | Small | 7 |
| 9 | ⏸ **Build `NetDeltaChip`** — gold-bordered chip with ▲/▼ + value tween. Reactive on side totals + `pricingByCert` resolution. | Medium | 8 |
| 10 | ⏸ **Build `TradeActionBar`** — Analyze + Execute buttons. Wire to existing `handleAnalyze` + `handleExecute` (with the relaxed `canExecute` validator per OQ-2). | Small | 9 |
| 11 | ⏵ **Add card-arrival animation** — Your Side (transit from picker tile) + Their Side (materialize on lookup). Includes side-total + Net Delta tween. | Large | 9 |
| 12 | ⏸ **Build `InlineAllocationPanel`** — total/allocated/remaining bar, allocation rows with auto/manual mode + reset, Cancel & Confirm buttons. Wire to existing `confirmTradeCost` + `cancelTrade`. New `allocations: {mode, value}` state shape with rebalancing. | Large | 10 |
| 13 | ⏸ **Build phase-transition animations** — building → pending slide-up, pending → building slide-down, pending → executed fade-out. Wire `phase` enum into transitions. | Medium | 12 |
| 14 | ⏵ **Restyle `PreFlightConfirmModal` + `ClaudeAnalysisModal` + `PastTradesSection`** to MASTER.md tokens. Pure visual; no logic. | Medium | 2, 1 |
| 15 | ⏸ **Wire `TradeDeskPage` to new `TradeCanvas`** — switch the import; remove the v1 TradeTab. Update `TradeDeskPage` eyebrow + dot to MASTER tokens. | Small | 4–14 |
| 16 | ⏸ **Delete legacy `TradeTab.jsx`** + the legacy `step` machine + the `TradeAnimationOverlay` overlay component + the `AnimThumbnail` component + their style block. Verify no other imports. | Small | 15 |
| 17 | ⏵ **Add unit tests** for `computeTradeCostBasis` edge cases the redesign exercises (pure acquisition, manual override rebalancing). | Small | 12 |
| 18 | ⏸ **Manual QA pass** in browser: build a standard trade, build pure-acquisition, cancel a pending, override allocation manually, hit allocation over-budget, watch every animation in slow-mo, then Cmd+R mid-pending and verify the recovery story. Document recovery story explicitly if not handled (probably the trade stays pending in DB and requires an admin nudge — flag it). | Medium | 16 |

**Estimated total scope:** ~3–5 working days for the full implementation if the scope above holds. Steps 4–13 are the meat (~70% of effort); steps 1–3 and 14–17 are mechanical.

---

*End of plan. Phase 2 implementation begins after human review of the open questions in §9.*
