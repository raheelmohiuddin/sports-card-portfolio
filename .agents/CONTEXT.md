# Collector's Reserve — Code-Level Context

> First read for any new Claude session picking up code work. Sits alongside
> `product-marketing-context.md` (positioning) and `design-system/MASTER.md`
> (visual tokens). This file is the **code map**: file inventory, helper API
> surfaces, component prop shapes, live DB schema, lifecycle semantics.
>
> **Update rule:** if a commit changes a documented surface (file purpose,
> exported helper signature, component prop shape, DB column, lifecycle
> state value), update this doc *in the same commit*. Drift here costs the
> next session hours of false-trail recon.

---

## 1. Purpose

This document captures everything a future Claude session needs to make
informed code changes without re-discovering the codebase from scratch:
which file does what, what helpers exist and what they return, how
components compose, the live database schema, and which lifecycle states
mean what. Runtime infrastructure details (account IDs, deploy commands,
git identity pattern) are also in here so a fresh session can act, not
just read.

---

## 2. Architecture Overview

Single React SPA (Vite) → AWS API Gateway → individual Node.js Lambdas
→ Aurora Serverless v2 (PostgreSQL 16). Auth via Cognito user pool;
tokens carried as `Authorization: Bearer` headers. Card images stored in
a private S3 bucket and served via signed URLs (1h TTL). Static frontend
hosted on Amplify, fronted by CloudFront + WAF.

**External integrations:**

| Service | Purpose | Lambda(s) |
|---|---|---|
| **PSA Public API** (`https://api.psacard.com/publicapi`) | Cert lookup for PSA-graded cards | `cards/psa-lookup.js` |
| **CardHedger** | Live pricing + cert lookup for BGS/SGC + image fallback + sales comps | `portfolio/pricing.js` (shared by `cards/lookup-cert.js`, `portfolio/refresh-portfolio.js`, `portfolio/get-card-sales.js`, `admin/get-card-sales.js`, `pricing/pricing-preview.js`) |
| **Anthropic Claude API** | Trade analysis + image moderation + edge-texture extraction | `trades/analyze-trade.js`, `cards/moderate-image.js`, `cards/generate-edge-texture.js` |
| **Fanatics Collectibles** | Consignment marketplace (admin-managed; no direct API) | n/a — partnership relationship |
| **AWS Cognito** | User auth + custom:role attribute (`collector` / `admin`) | `auth/post-confirmation.js` (sets default role); all handlers verify JWT |
| **Google Maps + Distance Matrix** | Travel time from zip → show city | `shows/get-travel-time.js` |
| **AWS SES v2** | Admin-notification email on new consignment | `consignments/create.js` (fire-and-forget) |

**AWS environment** (us-east-1, account `501789774892`):
- **Stack name**: `SportsCardPortfolio` (single CDK stack)
- **DB cluster identifier**: `sportscardportfolio-databasecluster5b53a178-asr01cwjobbs`
- **DB cluster ARN**: `arn:aws:rds:us-east-1:501789774892:cluster:sportscardportfolio-databasecluster5b53a178-asr01cwjobbs`
- **DB secret ARN**: `arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM`
- **DB name**: `cardportfolio`, master user `dbadmin`
- **API endpoint**: `https://d7r0yfjooj.execute-api.us-east-1.amazonaws.com`
- **Cognito user pool**: `us-east-1_77vBnz05o`, client `1unui8cgfcl3a6iq2iv1bl4d68`
- **CloudFront URL**: `https://dfsp491q2ndfx.cloudfront.net`
- **Card images bucket**: `sports-card-images-501789774892`
- **Aurora is in PRIVATE_ISOLATED subnets**. Direct connection from your laptop is impossible. Use **RDS Data API** (`enableDataApi: true` is set on the cluster) — Query Editor in the console, or `aws rds-data execute-statement` from CLI.

---

## 3. Frontend File Inventory

`frontend/src/` — React 18 + Vite. Inline-style design system (no Tailwind, no CSS-in-JS lib — each component owns a `st` constant).

### Top-level

| File | Lines | Purpose | Exports | Touch when |
|---|---:|---|---|---|
| `App.jsx` | 119 | Router + Authenticator.Provider + AnimatedRoutes (page-transition wrapper) + SiteFooter | default `App`, internal `ProtectedRoute` | Adding a route, changing the auth gate, tweaking page-transition behavior |
| `main.jsx` | 14 | Vite entrypoint — Amplify.configure + ReactDOM.render | (none) | Almost never |
| `aws-exports.js` | 9 | Cognito user pool + client IDs (gitignored — real values) | default `awsExports` | After CDK redeploys auth-stack |
| `aws-exports.example.js` | 14 | Template with placeholder values | default `awsExports` | When the auth config shape changes |
| `index.css` | ~270 | Global styles, body font (Inter), keyframes (livePulse, goldPulse, scp-trade-card-pulse, skeletonShimmer, spotlightTilt, spotlightShine, scp-trade-slide, etc.), small layout helpers (`.container`, `.scp-hero-grid`, `.scp-about-story-grid`, `.scp-spotlight-stage`, etc.) | (none) | Any global style/keyframe; responsive layout breakpoints that can't be inlined |

### `components/`

| File | Lines | Purpose | Exports | Touch when |
|---|---:|---|---|---|
| `Layout.jsx` | 886 | Top nav header (NavHeader) + bottom site footer (SiteFooter, auth-only) | default `NavHeader`, named `SiteFooter` | Nav links, header user menu, mobile menu, footer chrome |
| `CardModal.jsx` | 1015 | Right-slide-in card sidebar — collector view + admin variant when `adminConsignment` prop set | default `CardModal`, internal: `CardImage`, `TierBanner`, `PopStat`, `AdminConsignmentBlock`, `CostAndPnl` | Adding a card-detail surface; adjusting sold/held branching; admin-side card view |
| `ConsignBlock.jsx` | 502 | "Consign This Card" CTA, status pill, 3-row Sold/Fee/Net breakdown | default `ConsignBlock`, named `SoldBreakdown` | Consignment workflow UI; sold-card payout display; admin status reuse |
| `TradeTab.jsx` | 2908 | TradeDesk page body — given/received card pickers, allocation screen, AI analysis modals | default `TradeTab` | Anything in TradeDesk; trade execution UX; allocation flow; AI analysis modal |
| `SalesHistory.jsx` | 329 | Recent comps table inside CardModal — grade-filter dropdown + windowed list | default `SalesHistory` | Comp display; eBay/Fanatics Collect logo handling; grade-filter UX |
| `CardPop.jsx` | 72 | Click-to-zoom pop modal (image lightbox) | default `CardPop` | Image zoom UX; performance (already optimized — no backdrop-filter) |
| `AdminGuard.jsx` | 36 | Route guard for `/admin/*` — redirects unauth → /signin, non-admin → /portfolio | default `AdminGuard` | Admin-route protection logic |
| `DropZone.jsx` | 285 | Drag-and-drop file picker w/ async `verify` hook for image moderation | default `DropZone` | Add Card image upload UX; client-side moderation gate |
| `GhostIcon.jsx` | 63 | Animated SVG ghost icon for the rarest tier | default `GhostIcon` | Ghost-tier visuals |

### `pages/`

| File | Lines | Purpose | Exports | Touch when |
|---|---:|---|---|---|
| `HomePage.jsx` | 416 | Marketing homepage — split hero (text left / Spotlight rotating card right), partnership banner, features, CTA, footer | default `HomePage`, internal `Spotlight`, `SpotlightCard`, `usePrefersReducedMotion` | Marketing copy; hero animation; landing-page conversion |
| `AboutPage.jsx` | 256 | Story page — Editorial Dark refactor, 4-stat block, 3 pillars, CTA | default `AboutPage` | Brand story; pillars; about-page copy |
| `PortfolioPage.jsx` | 3596 | The big one — Dashboard + My Collection + Collection History tabs, hero stats, donut, performers, history chart, card grid + list view, edit-cost modal, milestone toast | default `PortfolioPage` + ~30 internal components | Anything dashboard-related; card tile design; toolbar; tab routing; performers/history/donut |
| `AddCardPage.jsx` | 774 | Cert-first add flow — grader selector → cert lookup → image upload → confirm | default `AddCardPage` | Add-card workflow; multi-grader handling; duplicate detection |
| `AdminPage.jsx` | 279 | `/admin` landing — 4 stat tiles + all-cards table | default `AdminPage`, named `AdminTopNav`, `fmt`, `fmtDate` | Admin dashboard; admin top nav (used by AdminConsignmentsPage too) |
| `AdminConsignmentsPage.jsx` | 885 | Admin consignment queue — sortable table with inline-editable Status / Sold Price / Fee % / Notes | default `AdminConsignmentsPage` | Admin consignment workflow; inline cell editors; queue filters |
| `TradeDeskPage.jsx` | 113 | Hosts TradeTab — fetches cards + past trades, navigates back to /portfolio?tab=collection on confirm | default `TradeDeskPage` | Trade page wiring; post-trade navigation |
| `ProfilePage.jsx` | 463 | Profile — avatar upload, given/family name + preferred_username editing | default `ProfilePage` | Account profile edits; avatar handling |
| `SettingsPage.jsx` | 356 | Settings — change password, notification toggle | default `SettingsPage` | Account settings; password change UX |
| `ShowsPage.jsx` | 2489 | Card shows finder — calendar, grid, Near Me filter, state filter, travel time | default `ShowsPage` | Anything shows-related; Near Me UX; calendar; travel-time integration |
| `SignInPage.jsx` | 202 | Cognito-hosted sign-in/sign-up via Amplify Authenticator with custom error vocabulary | default `SignInPage` | Auth UX; sign-up form custom fields; error messages |
| `UsernameSetupPage.jsx` | 195 | Post-confirmation step where user picks `preferred_username` (Cognito alias attr) | default `UsernameSetupPage` | New-user onboarding step |

### `services/`

| File | Lines | Purpose | Exports | Touch when |
|---|---:|---|---|---|
| `api.js` | 451 | Frontend API client — every fetch wrapper, JWT injection, error normalization | ~30 named exports (see §5) | Adding any new endpoint; changing a response shape |

### `utils/`

| File | Lines | Purpose | Exports | Touch when |
|---|---:|---|---|---|
| `portfolio.js` | 90 | P&L helpers — `isSold`, `isTraded`, `effectiveValue`, `cardPnl`, `summarizePortfolio` | named (see §5) | Anything that touches realized vs unrealized math |
| `rarity.js` | 30 | Tier classification from PSA pop data (ghost/ultra_rare/rare) | named: `getRarityTier`, `TIER_LABELS`, `TIER_COLORS` | Tier rules, label text, tier color mapping |
| `theme.js` | 76 | Color palette + gradient strings + `panelStyle` reusable object | named: `colors`, `gradients`, `adminColors`, `panelStyle` | Adding a global color/gradient token (otherwise prefer MASTER.md tokens inline) |
| `imageModeration.js` | 96 | Client-side image moderation: SHA-256 cache → canvas downsize → `/cards/moderate-image` | named: `moderateFile` | Add Card image flow; moderation cache strategy |
| `trade.js` | 21 | `computeTradeCostBasis` — pure cost math for the Trade Builder | named: `computeTradeCostBasis` | Trade allocation math |
| `__tests__/portfolio.test.js` | 133 | vitest — covers all `portfolio.js` exports | (test) | When changing portfolio helpers |
| `__tests__/rarity.test.js` | 48 | vitest — tier boundaries | (test) | When changing tier thresholds |
| `__tests__/trade.test.js` | 66 | vitest — trade cost basis edge cases | (test) | When changing trade.js |

---

## 4. Backend File Inventory

`backend/functions/` — AWS Lambda (Node.js, CommonJS, no bundler). Each handler exports `handler` and uses `_response.json()` to build responses.

### Top-level helpers (shared)

| File | Lines | Purpose | Exports | Touch when |
|---|---:|---|---|---|
| `_db.js` | 61 | Postgres connection pool + `ensureUser` upsert + `getUserRole` | named: `getPool`, `ensureUser`, `getUserRole` | DB pool config; user-row creation logic |
| `_admin.js` | 60 | `requireAdmin` — verifies `custom:role` claim with Cognito-live fallback | named: `requireAdmin` | Admin-auth changes; role-promotion handling |
| `_validate.js` | 51 | Input validation helpers | named: `isValidId`, `isValidCertNumber`, `sanitize`, `isHttpsUrl`, `isValidPrice`, `isValidCount` | Adding a new input validator |
| `_response.js` | 30 | HTTP response builder — security headers + JSON body | named: `json`, `noContent` | Security-header changes; new response shapes |
| `_image-helpers.js` | 34 | CardHedger image placeholder filter | named: `isPlaceholderImage`, `safeImageUrl` | When CardHedger introduces a new placeholder format |
| `_s3-helpers.js` | 18 | Card-image presigner (1h TTL, shared bucket) | named: `signedCardImageUrl` | If signed-URL TTL changes; if a new card-image bucket is added |

### `cards/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `add-card.js` | 150 | POST /cards — insert card row + return presigned PUT URLs for front/back images | Add-card schema/validation; image-upload key strategy |
| `get-cards.js` | 100 | GET /cards — full portfolio with consignment join + signed image URLs | Adding a column to the portfolio response; consignment-join logic |
| `get-card.js` | 95 | GET /cards/{id} — single card with fresh signed URLs | Single-card detail; CardModal payload |
| `delete-card.js` | 34 | DELETE /cards/{id} — removes card + S3 image objects | Delete behavior |
| `update-card.js` | 81 | PUT /cards/{id} — partial update (myCost only today) | Adding a new editable field |
| `update-price.js` | 38 | PATCH /cards/{id}/price — manual price override (or clear) | Manual-price override semantics |
| `psa-lookup.js` | 70 | GET /psa/{cert} — PSA Public API call + CDN image probe | PSA API contract; fallback image URLs |
| `lookup-cert.js` | 191 | POST /cards/lookup-cert — BGS/SGC cert lookup via CardHedger | Multi-grader response shaping |
| `moderate-image.js` | 118 | POST /cards/moderate-image — Claude vision moderation (fail-open) | Moderation prompt; allowed/blocked categories |
| `generate-edge-texture.js` | 93 | POST /cards/edge-texture — Claude vision returns card-edge color/texture | Card 3D-renderer edge handling |

### `admin/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `all-cards.js` | 53 | GET /admin/cards — every card joined to owner | Admin all-cards table |
| `get-card.js` | 98 | GET /admin/cards/{id} — admin single-card lookup (no ownership check) | Admin CardModal payload |
| `get-card-sales.js` | 105 | GET /admin/cards/{id}/sales — admin comps lookup (no ownership check) | Admin sales-history surface |
| `list-consignments.js` | 74 | GET /admin/consignments — every consignment joined to user + card | Admin consignment queue response |
| `update-consignment.js` | 135 | PATCH /admin/consignments/{id} — status/notes/sold_price/fee_pct edits + server-computed sellers_net | Admin consignment edits; fee/net math |
| `stats.js` | 33 | GET /admin/stats — high-level aggregates (1 round-trip, multiple subqueries) | Admin dashboard tiles |

### `trades/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `execute-trade.js` | 226 | POST /trades/execute — atomic shuffle: mark given as 'traded', insert received, create pending trade row + trade_cards snapshots | Trade execution semantics |
| `confirm-cost.js` | 134 | POST /trades/confirm-cost — allocate cost basis to received cards, flip trade to 'executed' | Cost allocation logic |
| `cancel-trade.js` | 116 | POST /trades/cancel — atomic rollback (gated on status='pending') | Trade cancel semantics |
| `analyze-trade.js` | 277 | POST /trades/analyze — Claude Sonnet 4.6 with structured tool_use → verdict + reasoning | AI analysis prompt; verdict enum |
| `list-trades.js` | 77 | GET /trades — executed trade history (status='executed' only; pending excluded) | Trade history surface |

### `consignments/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `create.js` | 156 | POST /consignments — collector creates request + fire-and-forget admin SES email | Consignment intake validation; admin email |

### `portfolio/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `get-value.js` | 79 | GET /portfolio/value — fast cards+value read, no CardHedger calls | Dashboard fast-path response |
| `get-history.js` | 28 | GET /portfolio/history — portfolio_snapshots time series (max 500 rows) | Price-history chart payload |
| `get-card-sales.js` | 144 | GET /cards/{id}/sales — cached comps OR live CardHedger fetch by grade | Sales history; grade-filter behavior |
| `pricing.js` | 237 | CardHedger client — `fetchMarketValue`, `fetchComps`, `fetchAllPrices`, `gradeLabel` (shared by lookup-cert, refresh, get-card-sales) | CardHedger contract; lookup chain |
| `refresh-portfolio.js` | 130 | POST /portfolio/refresh — background CardHedger refresh of stale cards (24h gate) or scoped to cardIds | Refresh staleness window; targeted refresh |

### `pricing/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `pricing-preview.js` | 64 | POST /pricing/preview — CardHedger lookup without persisting (Trade Builder previews) | Trade preview pricing |

### `shows/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `list-shows.js` | 148 | GET /shows — upcoming shows joined to user_shows (attending flag + notes) | Shows query; calendar/grid response |
| `mark-attending.js` | 42 | POST /shows/{id}/attending — idempotent attending toggle | Attending UX |
| `unmark-attending.js` | 29 | DELETE /shows/{id}/attending | Un-attending |
| `get-travel-time.js` | 139 | GET /travel-time — Google Geocoding + Distance Matrix → drive/fly time | Travel-time logic |
| `import-shows.js` | 131 | Direct-invoke Lambda — bulk import card shows from JSON | Show data ingestion |
| `apply-show-coords.js` | 97 | Direct-invoke Lambda — geocoder coord backfill | Show coordinate backfill |

### `profile/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `get-avatar-upload-url.js` | 37 | POST /profile/avatar-upload-url — presigned PUT URL + key | Avatar upload flow |
| `get-avatar-view-url.js` | 32 | GET /profile/avatar-view-url — presigned GET URL (own-key only) | Avatar display |

### `auth/`

| File | Lines | Purpose | Touch when |
|---|---:|---|---|
| `post-confirmation.js` | 36 | Cognito PostConfirmation trigger — stamps `custom:role=collector` on every new account | Default role; signup flow |

### `_migrations/`

One-off migration Lambdas, **direct-invoke only** (`aws lambda invoke`), all idempotent. Listed for awareness — most are historical; `0001_consignment_fee.sql` (under `backend/db/migrations/`) is the only file-based migration so far. Every Lambda below has a docstring explaining what it adds:

| File | Adds |
|---|---|
| `add-my-cost.js` | `cards.my_cost` |
| `add-portfolio-features.js` | `cards.target_price` + `portfolio_snapshots` table |
| `add-snapshot-total-cost.js` | `portfolio_snapshots.total_cost` |
| `add-roles-and-consignments.js` | `users.role`, `users.given_name`, `users.family_name`, `consignments` table |
| `add-sold-price.js` | `consignments.sold_price` |
| `add-auction-platform.js` | `consignments.auction_platform` |
| `add-consignment-blocks.js` | `consignments.ever_declined` + `consignment_blocks` table |
| `add-grader-column.js` | `cards.grader` (PSA/BGS/SGC) |
| `add-cardhedger-columns.js` | `cards.cardhedger_id` + `cards.raw_comps` |
| `add-cardhedger-image-url.js` | `cards.cardhedger_image_url` |
| `add-trades-tables.js` | `trades`, `trade_cards`, `cards.status` |
| `add-shows-tables.js` | `card_shows`, `user_shows` |
| `add-show-coords.js` | `card_shows.lat`, `card_shows.lng` |
| `add-end-date-and-merge-shows.js` | `card_shows.end_date` + dedupe consecutive-day shows |
| `add-daily-times.js` | `card_shows.daily_times` JSONB |

---

## 5. Helper API Surface

### `frontend/src/utils/portfolio.js`

```js
isSold(card)            → boolean   // consignmentStatus === "sold" && consignmentSoldPrice != null
isTraded(card)          → boolean   // status === "traded"
effectiveValue(card)    → number|null
                                    // sold:   sellersNet ?? consignmentSoldPrice
                                    // held:   estimatedValue ?? null
cardPnl(card)           → number|null  // effectiveValue - myCost (null if either missing)
summarizePortfolio(cards) → {
  realizedPnl, unrealizedPnl, totalPnl,
  realizedValue, unrealizedValue, totalValue,
  investedSold, investedHeld, totalInvested,
  soldCount, heldCount,
  hasSoldCost, hasHeldCost
}
```

### `frontend/src/utils/rarity.js`

```js
getRarityTier(card) → "ghost" | "ultra_rare" | "rare" | null
                      // requires psaPopulationHigher === 0
                      // ghost: pop ≤ 5, ultra_rare: 6–25, rare: 26–50

TIER_LABELS = { ghost: "GHOST", ultra_rare: "ULTRA RARE", rare: "RARE" }
TIER_COLORS = { ghost: "#e2e8f0", ultra_rare: "#f59e0b", rare: "#93c5fd" }
                  // ⚠ TIER_COLORS still uses warning amber for ultra_rare;
                  //   MASTER.md token is gold-primary #d4af37.
```

### `frontend/src/utils/theme.js`

```js
colors = {
  gold: "#f59e0b", goldLight: "#fbbf24", goldDark: "#d97706",
  bg: "#0f172a", bgDarker: "#0a0f1f",
  textPrimary: "#f1f5f9", textSecondary: "#cbd5e1",
  textMuted: "#94a3b8", textFaint: "#64748b", textVeryFaint: "#475569",
  green: "#10b981", red: "#f87171",
  borderSoft: "rgba(255,255,255,0.06)", borderGold: "rgba(245,158,11,0.4)",
}

gradients = {
  pageDark:         radial dark navy
  goldPanel:        3-stop gold-tint panel wash (still warning amber — MASTER.md is the source of truth)
  goldPanelSimple:  2-stop variant
  goldPill:         linear amber → dark amber (used on legacy CTAs)
  violetPanel:      admin variant
  violetPill:       admin pill
}

adminColors = { accent: "#a78bfa", accentLight: "#c4b5fd", accentDark: "#7c3aed", border: "rgba(167,139,250,0.28)" }

panelStyle = { background: gradients.goldPanel, border: 1px borderSoft, borderRadius: 16 }
```

> **Note:** `theme.js` predates the Editorial Dark token system formalized
> in `MASTER.md`. The `goldPanel` gradient + `colors.gold` (`#f59e0b`) are
> legacy warning-amber values that survive in 7+ pages (TradeTab, Shows,
> AddCard, Profile, Settings, AdminConsignments, AdminPage). New work
> should consume MASTER.md tokens (`#d4af37` gold-primary, flat surface-1)
> directly inline; `theme.js` is being phased out, not extended.

### `frontend/src/services/api.js`

All async, all return parsed JSON unless noted, all throw on non-2xx (rich `Error` with `.status` and `.data` for 409/4xx flows via the internal `readError` helper).

```js
// PSA / cert lookup
lookupPsaCert(certNumber)             → PSA Lambda response shape
lookupCert(certNumber, grader)        // routes PSA → /psa/{cert}, BGS/SGC → /cards/lookup-cert

// Cards CRUD
addCard(cardData)                     → { id, frontUploadUrl, backUploadUrl }
getCards()                            → Card[] (full portfolio)
getCard(id)                           → Card (fresh signed URLs, cache: no-store)
deleteCard(id)                        → 204
updateCard(id, patch)                 → Card  (currently myCost only)
updateCardPrice(id, manualPrice)      // null = clear override
uploadCardImages({ frontUploadUrl, frontFile, backUploadUrl, backFile })

// Portfolio
getPortfolioValue()                   → { totalValue, cards: [...], tradesExecuted }
getPortfolioHistory()                 → snapshot[] (timestamp, totalValue, totalCost, cardCount)
refreshPortfolio()                    → { refreshed, skipped, failed }   // walks stale cards
refreshPortfolio({ cardIds })         → same shape (scoped, bypasses staleness gate)
getCardSales(id, grade, { signal })   → { sales: [...], availableGrades, currentGrade }
previewPricing(card)                  → { available: bool, avgSalePrice, lastSalePrice, ... }

// Trades
executeTrade(payload)                 → { tradeId, receivedCards: [{ id, certNumber }] }
confirmTradeCost({ tradeId, allocations: [{ certNumber, cost }] })
cancelTrade(tradeId)
listTrades()                          → Trade[]
analyzeTrade(payload)                 → { summary, verdict, confidence, keyReasons, ... }

// Consignments (collector)
createConsignment({ cardId, type, askingPrice, auctionPlatform, notes })

// Admin
getAdminStats()                       → aggregate stats
getAdminCards()                       → all cards + owners
getAdminConsignments()                → consignment queue with user + card join
getAdminCard(id)                      → admin single card (no ownership check)
getAdminCardSales(id, grade)          → admin comps
updateAdminConsignment(id, patch)     → updated row (server-computed sellersNet)

// Card shows
getShows({ states, from, to, q, centerLat, centerLng, radiusMiles })
markAttending(showId, notes?)
unmarkAttending(showId)
getTravelTime({ originZip, destCity, destState, destCountry? })
                                      → { mode: "drive"|"fly", durationMinutes, distanceMiles }

// Profile
getAvatarUploadUrl(contentType)       → { uploadUrl, key, contentType }
getAvatarViewUrl(key)                 → { viewUrl }

// Other
moderateImage({ image, contentType }) → { allowed, reason, unverified? }   // fail-open
generateEdgeTexture(imageUrl)         → { edgeColor, texture }
```

### `backend/functions/_db.js`

```js
getPool()                             → pg.Pool (cached; SecretsManager-backed creds; SSL)
ensureUser(db, sub, email, givenName?, familyName?) → userId (uuid)
                                      // upserts on cognito_sub; never touches role
getUserRole(db, sub)                  → "admin" | "collector" | null
```

### `backend/functions/_admin.js`

```js
requireAdmin(event, _db) → { claims }   on success
                         | { error: response }   on failure (403, never 401 leak)
// Fast path: signed JWT custom:role === "admin"
// Slow path: AdminGetUser against Cognito (≤ 100ms) — handles stale tokens
//            after a console role promotion
```

### `backend/functions/_validate.js`

```js
isValidId(val)            // UUID or positive integer
isValidCertNumber(val)    // alphanumeric, 1–30 chars
sanitize(val, maxLen=500) // trim + slice
isHttpsUrl(val)           // valid absolute https URL
isValidPrice(val)         // finite, ≥ 0, < 10_000_000
isValidCount(val)         // null/undef OK, else non-negative int
```

### `backend/functions/_response.js`

```js
json(statusCode, body)    → API Gateway response with security headers + JSON body
noContent()               → 204 with security headers, empty body
                          // Headers: Content-Type, X-Content-Type-Options, X-Frame-Options,
                          //          Strict-Transport-Security, Referrer-Policy, Cache-Control
```

### `backend/functions/_image-helpers.js`

```js
isPlaceholderImage(url) → boolean    // CardHedger sport-bucket placeholders + appforest_uf URLs
safeImageUrl(url)       → string|null  // null when missing/blank/placeholder
```

### `backend/functions/_s3-helpers.js`

```js
signedCardImageUrl(key) → presigned GET URL (1h TTL, CARD_IMAGES_BUCKET)
```

---

## 6. Key Component Prop Shapes

### `CardModal` — `components/CardModal.jsx`

```ts
{
  card: Card                                // required — full card object (or stub)
  onClose: () => void                       // required
  loaders?: { getCard, getCardSales }       // admin override — defaults to user-scoped api
  adminConsignment?: Consignment            // when set: renders AdminConsignmentBlock,
                                            // suppresses collector ConsignBlock
  onCardUpdate?: (id, patch) => void        // callback for inline child mutations
                                            // (consignmentStatus flips, manual price overrides)
}
```

### `ConsignBlock` — `components/ConsignBlock.jsx` (default)

```ts
{
  cardId: string                            // required
  role?: "admin" | "collector" | null       // role === "admin" → returns null
  cardStatus?: string                       // "traded" → returns null
  consignmentStatus?: ConsignmentStatus     // null → CTA path; set → StatusPill path
  consignmentSoldPrice?: number             // sold-status display
  consignmentFeePct?: number                // 0–100 — drives SoldBreakdown panel
  sellersNet?: number                       // server-computed — drives SoldBreakdown panel
  consignmentBlocked?: boolean              // true → BlockedMessage (terminal)
  onConsigned?: (status: "pending") => void // fired after successful submit
}
```

### `SoldBreakdown` — `components/ConsignBlock.jsx` (named export)

```ts
{
  soldPrice: number    // gross sale (white)
  feePct: number       // 0–100, displayed as percentage in fee row
  sellersNet: number   // dominant gold figure ("Seller's Net")
}
```

### `TradeTab` — `components/TradeTab.jsx`

```ts
{
  cards: Card[]                             // required — all user cards (filtered to tradable internally)
  onTradeComplete: (newCardIds) => void     // required — parent navigates after confirm
  pastTrades: Trade[]                       // for "Past Trades" section
  historyLoading: boolean
  historyError: string | null
}
```

### `Layout` (NavHeader) — `components/Layout.jsx` (default)

```ts
{}   // no props — reads auth state via useAuthenticator + Cognito attributes internally
```

### `SiteFooter` — `components/Layout.jsx` (named)

```ts
{}   // no props — returns null when authStatus !== "authenticated"
```

### `SalesHistory` — `components/SalesHistory.jsx`

```ts
{
  card: Card                                // required — drives initial fetch
  loadSales: (id, grade?, { signal }) => Promise<{ sales, availableGrades, currentGrade }>
                                            // required — swap with admin variant via CardModal.loaders
}
```

### `CardPop` — `components/CardPop.jsx`

```ts
{
  open: boolean                             // toggles visibility (always mounted)
  src: string | null                        // image URL
  alt?: string                              // accessibility
  onClose: () => void
}
```

### `AdminGuard` — `components/AdminGuard.jsx`

```ts
{ children: ReactNode }
// Three-state: "loading" → placeholder; unauth → /signin; authed-non-admin → /portfolio
```

---

## 7. Status / Lifecycle Semantics

### `card.status` (column on `cards` table, type `text`, nullable)

| Value | Meaning | Set by |
|---|---|---|
| `NULL` | Active in the user's portfolio (default) | `cards/add-card.js` (default), `trades/cancel-trade.js` (rollback) |
| `"traded"` | User traded this card away. Card stays in DB for history but excluded from active tabs. | `trades/execute-trade.js` |

`isTraded(card)` ≡ `card.status === "traded"`. Currently no other values defined.

### `card.consignmentStatus` (latest row from `consignments` table via LATERAL join)

| Value | Meaning | Set by |
|---|---|---|
| `NULL` | No consignment exists for this card | (default — no row) |
| `"pending"` | Collector submitted; admin hasn't reviewed | `consignments/create.js` (insert), `admin/update-consignment.js` (PATCH) |
| `"in_review"` | Admin actively reviewing | `admin/update-consignment.js` |
| `"listed"` | Live on the marketplace | `admin/update-consignment.js` |
| `"sold"` | Terminal — payout settled | `admin/update-consignment.js` |
| `"declined"` | Terminal — admin rejected. Also writes `consignment_blocks` row keyed on `(user_id, cert_number)` so the block survives card delete + re-add. `consignments.ever_declined` latches to TRUE. | `admin/update-consignment.js` |

`isSold(card)` ≡ `card.consignmentStatus === "sold" && card.consignmentSoldPrice != null` — stricter than just status, because the sold-price block in the UI requires a number to display.

### Trade lifecycle (`trades.status` column, type `text`, NOT NULL)

```
              ┌──────────────────────────┐
              │ POST /trades/execute     │
              │ • cards.status='traded'  │
              │ • insert received cards  │
              │ • create trade row       │
              │ • snapshot trade_cards   │
              └──────────┬───────────────┘
                         ▼
                   ┌──────────┐
                   │ pending  │ ← status='pending' on the trades row
                   └──┬───┬───┘
            cancel    │   │   confirm-cost
                      ▼   ▼
   ┌──────────────────┐   ┌──────────────────────┐
   │ POST /trades/    │   │ POST /trades/        │
   │ cancel           │   │ confirm-cost         │
   │ • status check   │   │ • allocate my_cost   │
   │ • restore given  │   │ • set trade_cards    │
   │ • delete recvd   │   │   .allocated_cost    │
   │ • delete trade   │   │ • status='executed'  │
   └──────────────────┘   └──────────────────────┘
                                     │
                                     ▼
                              ┌──────────┐
                              │ executed │ ← terminal; surfaces in /trades list
                              └──────────┘
```

`list-trades.js` returns only `status='executed'`. Pending and cancelled trades never appear in trade history.

### Where each status value gets written (cheat-sheet)

| Field | Written by |
|---|---|
| `cards.status = 'traded'` | `trades/execute-trade.js:140` |
| `cards.status = NULL` (rollback) | `trades/cancel-trade.js:68` |
| `consignments.status` (any value) | `admin/update-consignment.js` (with `VALID_STATUSES` enum guard) |
| `consignments.status = 'pending'` (creation) | `consignments/create.js` |
| `consignments.ever_declined = TRUE` | `admin/update-consignment.js` (when `status = 'declined'`) |
| `consignment_blocks` row insert | `admin/update-consignment.js` (when `status = 'declined'`) |
| `trades.status = 'pending'` | `trades/execute-trade.js` |
| `trades.status = 'executed'` | `trades/confirm-cost.js:120` |

---

## 8. Database Schema (live)

> **The bootstrap file `backend/db/schema.sql` is severely stale.** It only
> defines the initial `users` + `cards` tables and predates ~15 ALTER
> migrations. Use this section as the truth. Live schema dumped via RDS
> Data API (`information_schema.columns`, table_schema='public').
>
> Format: `column | type | nullable`

### `users`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| cognito_sub | varchar(255) | NO |
| email | varchar(255) | NO |
| created_at | timestamptz | YES |
| given_name | varchar(80) | YES |
| family_name | varchar(80) | YES |
| role | varchar(20) | NO |

### `cards`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| user_id | uuid | NO |
| cert_number | varchar(50) | NO |
| year | varchar(10) | YES |
| brand | varchar(100) | YES |
| sport | varchar(100) | YES |
| player_name | varchar(255) | YES |
| card_number | varchar(50) | YES |
| grade | varchar(10) | YES |
| grade_description | varchar(100) | YES |
| image_url | text | YES |
| s3_image_key | varchar(500) | YES |
| psa_data | jsonb | YES |
| estimated_value | numeric(10,2) | YES |
| value_last_updated | timestamptz | YES |
| added_at | timestamptz | YES |
| s3_back_image_key | varchar(500) | YES |
| back_image_url | text | YES |
| avg_sale_price | numeric(10,2) | YES |
| last_sale_price | numeric(10,2) | YES |
| num_sales | integer | YES |
| price_source | varchar(20) | YES |
| manual_price | numeric(10,2) | YES |
| psa_population | integer | YES |
| psa_population_higher | integer | YES |
| my_cost | numeric(10,2) | YES |
| target_price | numeric(10,2) | YES |
| cardhedger_id | text | YES |
| raw_comps | jsonb | YES |
| cardhedger_image_url | text | YES |
| status | text | YES |
| grader | text | YES |

### `consignments`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| user_id | uuid | NO |
| card_id | uuid | NO |
| type | varchar(20) | NO |
| asking_price | numeric(10,2) | YES |
| notes | text | YES |
| status | varchar(20) | NO |
| internal_notes | text | YES |
| created_at | timestamptz | NO |
| updated_at | timestamptz | NO |
| sold_price | numeric(10,2) | YES |
| auction_platform | varchar(20) | YES |
| ever_declined | boolean | NO |
| consignment_fee_pct | numeric(5,2) | YES |
| sellers_net | numeric(10,2) | YES |

### `consignment_blocks`

| Column | Type | Nullable |
|---|---|---|
| user_id | uuid | NO |
| cert_number | varchar(50) | NO |
| blocked_at | timestamptz | NO |
| reason | varchar(20) | NO |

### `trades`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| user_id | uuid | NO |
| traded_at | timestamptz | NO |
| cash_given | numeric(12,2) | YES |
| cash_received | numeric(12,2) | YES |
| notes | text | YES |
| status | text | NO |

### `trade_cards`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| trade_id | uuid | NO |
| card_id | uuid | NO |
| side | text | NO |
| cert_number | varchar(50) | YES |
| player_name | varchar(255) | YES |
| year | varchar(10) | YES |
| brand | varchar(100) | YES |
| grade | varchar(10) | YES |
| estimated_value | numeric(10,2) | YES |
| allocated_cost | numeric(10,2) | YES |

### `portfolio_snapshots`

| Column | Type | Nullable |
|---|---|---|
| id | bigint | NO |
| user_id | uuid | NO |
| snapshot_at | timestamp | NO |
| total_value | numeric(12,2) | NO |
| card_count | integer | NO |
| total_cost | numeric(12,2) | YES |

### `card_shows`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| tcdb_id | integer | NO |
| name | varchar(500) | YES |
| venue | varchar(500) | YES |
| city | varchar(200) | YES |
| state | varchar(50) | YES |
| country | varchar(100) | YES |
| show_date | date | YES |
| start_time | varchar(50) | YES |
| end_time | varchar(50) | YES |
| created_at | timestamptz | NO |
| updated_at | timestamptz | NO |
| end_date | date | YES |
| daily_times | jsonb | YES |
| lat | numeric(9,6) | YES |
| lng | numeric(9,6) | YES |

### `user_shows`

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| user_id | uuid | NO |
| card_show_id | uuid | NO |
| notes | text | YES |
| created_at | timestamptz | NO |

### Tables NOT in `db/schema.sql`

The bootstrap file defines only `users` (4 cols) and `cards` (16 cols). **Everything else** has been added via the migration Lambdas under `_migrations/` (which run direct-invoke via `aws lambda invoke`):

- All 8 tables besides `users` and `cards` are post-bootstrap additions
- `users` has gained 3 columns (given_name, family_name, role) since bootstrap
- `cards` has gained 16 columns since bootstrap (status, grader, my_cost, target_price, raw_comps, cardhedger_*, manual_price, psa_population*, etc.)

The `0001_consignment_fee.sql` file under `backend/db/migrations/` is the only migration that lives as a SQL file (vs. a Lambda) — applied manually via Query Editor. New schema changes should follow that pattern.

---

## 9. Design System Quick Reference

> Full spec lives in `.agents/design-system/MASTER.md` — do not duplicate
> tokens here. This is just the cheat-sheet.

**Three rules that the design lives or dies by:**

1. **Tabular figures** on every price/numeric column (`font-variant-numeric: tabular-nums`).
2. **Gold scarcity** — `gold-primary #d4af37` only on portfolio total value, ◆ brand mark, and Ghost/Ultra Rare tier badges. Never on CTAs.
3. **Gain/loss with icons** — `▲` / `▼` paired with green/red. Color alone is colorblind-unsafe.

**Canonical token values:**

| Token | Value | Use |
|---|---|---|
| `bg-base` | `#0a0e1a` | App background |
| `surface-1` | `#0f172a` | Cards, panels |
| `surface-2` | `#1a2332` | Raised: modals, hover row |
| `hairline` | `rgba(255,255,255,0.06)` | Dividers |
| `gold-primary` | `#d4af37` | Antique gold (replaces warning amber `#f59e0b`) |
| `gold-bright` | `#e6c463` | Hover state |
| `text-primary` | `#f8fafc` | Headings |
| `text-secondary` | `#cbd5e1` | Body |
| `text-muted` | `#94a3b8` | Labels |
| `gain` | `#34d399` | ▲ price up |
| `loss` | `#f87171` | ▼ price down |
| `info` | `#60a5fa` | Notifications, links |

**Typography:** Inter only, loaded with `opsz` 14–32 axis. Display headings use `font-variation-settings: 'opsz' 32` + tighter tracking; body uses default. JetBrains Mono is a fallback chain (`'JetBrains Mono', 'Fira Code', monospace`), not loaded from Google.

---

## 10. Known State / Open Gaps

### Recently completed (do not re-do)

- ✅ Editorial Dark design system formalized (commit `a23ba12`)
- ✅ Inter Display swap, Fraunces removed (commit `ba8d175`)
- ✅ Spotlight hero card on homepage (`a23ba12`)
- ✅ Split-layout homepage hero (`a23ba12`)
- ✅ My Cards → My Collection rename, My Past Collection → Collection History rename (`3464754`)
- ✅ Consignment fee + sellers_net column + 3-row Sold/Fee/Net breakdown (`ea522aa`)
- ✅ Admin sidebar reuses `SoldBreakdown` for visual parity (`ea522aa`)
- ✅ Collection History P&L uses `sellersNet ?? consignmentSoldPrice` (`ea522aa`)
- ✅ AboutPage Editorial Dark refactor (`2864654`)
- ✅ Dashboard hero rework — Portfolio Value primary, P&L secondary, Avg Card Value dropped (`ed42bc8`)
- ✅ CardTile redesign + revert (corner ribbons + tier pill kept; full info bar restored) (`ed42bc8`)
- ✅ Uniform tile height + PopBadge overflow fix (`ed42bc8`)
- ✅ Dead style keys removed: `soldStamp`, `tradedStamp` (`27afbdf`)
- ✅ Debug `console.log` calls in update-consignment Lambda + CardModal removed
- ✅ RDS Data API enabled on the cluster (so Query Editor works)
- ✅ Co-Authored-By trailers stripped from commits 4535c8a/685ca6d/ed42bc8 (rebased to ba8d175/2864654/ed42bc8)

### Still stubbed / missing

- **CardModal not formally `readOnly`-gated.** Tile-level edit/delete are hidden in Collection History via `readOnly` on CardGrid/CardListView. CardModal itself has no `readOnly` prop. ConsignBlock self-suppresses for traded cards and renders a read-only StatusPill for sold cards, so there's no *currently* leaking mutation — but the gate would be belt-and-braces against future changes.
- **"Trade details" panel for traded cards in CardModal not implemented.** The original Collection History spec asked for counterparty/date/ratio in the sidebar for traded cards. No Lambda surfaces this yet (the data exists in `trade_cards` snapshot).
- **Stripe billing not built.** Subscription tiers planned but free during beta.
- **Raw card support: by design not planned.** Cert-first workflow is the wedge.
- **Manual price-edit on tile: removed.** Cost-basis edit (✎ → EditCostModal) still works. Manual price override only via the `updateCardPrice` API now (no UI surface).
- **Data export not built.** Flagged in marketing context as a switching-anxiety mitigation; users own their data but there's no export button.

### Known design-system inconsistencies (low-priority cleanup)

- **`utils/theme.js` is legacy.** `colors.gold` is `#f59e0b` (warning amber); `gradients.goldPanel` consumes that color. 7+ pages still render the old gradient (TradeTab, ShowsPage, AdminPage, AdminConsignmentsPage, AddCardPage, ProfilePage, SettingsPage, plus PortfolioPage's `goldPanelSimple` use). New work should bypass `theme.js` and inline MASTER.md tokens; theme.js is being phased out, not extended.
- **`utils/rarity.js` `TIER_COLORS.ultra_rare` is `#f59e0b`.** Same warning-amber drift; the corner pill in CardTile uses `#d4af37` directly, not this token.
- **`AnimatedRoutes` (App.jsx) hover stickiness on touch devices.** The route-fade transition can leave hover state stuck on mobile after a tap-navigate. Minor.

### Documentation drift to watch for

- `backend/db/schema.sql` has not been updated since the bootstrap and is no longer trustworthy (see §8). Either update it to mirror live schema or replace with a pointer to this file.
- The earlier session-handoff (informally generated, not committed) is now superseded by this document.

---

## 11. Workflow Notes

### Local environment

- **OS:** Windows 11. Default shell: PowerShell 5.1 (no `&&` chain operator — use `;`). Bash via git-bash also available; this doc assumes Bash for shell snippets.
- **Python: not installed.** Microsoft Store stubs will fail with cryptic errors. Use `jq` or `sed` for JSON parsing — never `python3 -m json.tool`.
- **Node:** required for `npx cdk deploy` and Lambda local dev.
- **AWS CLI:** authenticated as root user (`501789774892`). Suboptimal — IAM role would be cleaner — but works.

### Database access

The cluster is in `PRIVATE_ISOLATED` subnets. **You cannot connect directly** from the dev machine. Two options:

1. **RDS Query Editor** (browser, fastest): Console → RDS → Query Editor → "Connect with a Secrets Manager ARN" → paste the secret ARN from §2 → DB `cardportfolio`.
2. **`aws rds-data execute-statement`** from CLI (scriptable):
   ```bash
   aws rds-data execute-statement \
     --secret-arn "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" \
     --resource-arn "arn:aws:rds:us-east-1:501789774892:cluster:sportscardportfolio-databasecluster5b53a178-asr01cwjobbs" \
     --database cardportfolio \
     --region us-east-1 \
     --sql "<sql here>"
   ```

### Git identity

**Never modify `.git/config`.** No git identity is set on this machine. Use inline `-c` flags on every commit:

```bash
git -c user.name="Raheel Mohiuddin" \
    -c user.email="raheelmohiuddin@users.noreply.github.com" \
    commit -m "..."
```

For `git rebase` (which calls git internally), set committer via env vars:
```bash
GIT_COMMITTER_NAME="Raheel Mohiuddin" \
GIT_COMMITTER_EMAIL="raheelmohiuddin@users.noreply.github.com" \
git rebase ...
```

Co-Authored-By trailers on AI-assisted commits: project history is mixed (some have, some don't). Recent precedent (commits since the rebase) is **no trailer**.

### Deploy

Single CDK stack:

```bash
cd infrastructure
npx cdk diff               # always run first to preview
npx cdk deploy --require-approval never
```

Frontend ships via Amplify auto-deploy from GitHub `master` — no manual frontend deploy.

**Order for schema-affecting changes:**
1. Apply the migration (RDS Query Editor, manual)
2. Verify columns exist (`SELECT column_name FROM information_schema.columns WHERE ...`)
3. THEN `cdk deploy` Lambda code that references the new columns

Reverse this order and you'll briefly serve 500s from `get-cards` (which fans out to the entire portfolio page for every user).

### CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push to `master` and every PR. Three parallel jobs: backend Jest tests, frontend Vitest tests, frontend Vite build (with a stubbed `aws-exports.js` since the real file is gitignored). Concurrency cancels in-flight runs on a stale ref. The status check is the live gate — expected to be green before any merge or deploy.

- **Deploys are manual.** Always have been. Use the `npx cdk deploy` flow above; frontend rides Amplify's own GitHub trigger. There is no automated CDK pipeline.

- **A `deploy.yml` workflow used to sit alongside `ci.yml`** but it was aspirational scaffolding that never ran successfully. It expected three GitHub Actions secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) that were never configured on the repo, and failed in 23–32 seconds on every push from **2026-05-10 to 2026-05-12 — 8 runs, 0 successes**, all dying at `Configure AWS credentials` with `Input required and not supplied: aws-region` before any deploy logic ran. It was removed (and this note added) so the red status check stops appearing on every push.

- **Security audit** (`.github/workflows/security.yml`) runs weekly (Monday 09:00 UTC) and on-demand. `npm audit` over prod deps only (high/critical threshold) plus TruffleHog verified-only secret scan. Files a `security`-labeled GitHub issue when either surfaces findings.

- **If auto-deploy is wanted in the future**, the preferred path is **GitHub OIDC → IAM role with cdk-deploy permissions**, not long-lived access keys. (The removed `deploy.yml`'s own header comment called this out.) Short-lived tokens scoped to a single workflow run; no secret rotation; no permanent CI access if the repo is ever compromised. The `aws-actions/configure-aws-credentials` action supports it via `role-to-assume`.

### Migrations

Two patterns coexist:

- **Lambda-based** (legacy): `backend/functions/_migrations/<name>.js` — direct-invoke only (`aws lambda invoke`), idempotent. Most historical migrations live here.
- **SQL-file-based** (preferred going forward): `backend/db/migrations/<NNNN>_<name>.sql` — applied manually via Query Editor. Use `IF NOT EXISTS` to keep them idempotent. There is no automated runner.

Number prefix is monotonic (`0001_consignment_fee.sql` is the only one so far).
