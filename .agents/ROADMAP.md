# ROADMAP — Parked items, future features, completed audits

> Running registry of work that's been considered, scoped, or surfaced
> but not yet committed to a release window. Sized rough (S/M/L/XL) for
> planning, with trigger conditions where applicable. Items move OUT of
> this file when they ship (referenced from `CONTEXT.md` §10 if needed
> for history) or when they're explicitly killed.
>
> One-line descriptions only. Detailed plans live in their own files
> (e.g. `mark-as-sold-plan.md`, `valuation-rebuild-plan.md`) and get
> linked from here when active.

---

## Features

- **Wishlist tab** — let users track cards they want, mirror Collection tile pattern. Includes add/remove, view, move-to-collection on acquisition. v1 excludes price alerts and marketplace integrations. Size: M
- **Wishlist → Acquisition flow (manual-mediated v1)** — User picks wishlist card, sees admin-quoted acquisition price, accepts via DocuSign agreement, system emails consignor network for sourcing. Manual touchpoints for envelope creation, price quotes, sourcing-status tracking. Validates demand before automating. Open questions: consignor role/permission model, business model, refund policy, escrow handling. Size: L
- **Wishlist → Acquisition flow (automated v2)** — Algorithmic pricing, programmatic DocuSign, live bounty bidding, real-time notifications, automated payouts. Trigger: v1 validates demand AND unit economics support engineering cost. Until then, do not start. Size: XL
- **Native mobile app (Capacitor wrapper)** — Start with PWA, evaluate wrapper if usage demands. Size: L
- **Instagram outbound share (V1)** — Share card image + watermark, default cost/P&L privacy off. Size: M
- **"Undo mark as sold"** — OQ-3 deferred until first user reports an accidental sale. Size: S
- **TCDB API migration for My Shows** — Replace current static data with live TCDB API. Size: M
- **Home page partner section update** — change "Exclusive Partner" to "Our Partners" and add PSA logo alongside Fanatics. Needs official transparent PSA logo asset (or a successful re-attempt at automated checker-pattern removal). Size: S

## Bug fixes / audits

- **Messi cert 21364651 variant investigation** — Flagged during valuation rebuild verification. Size: S
- **admin/stats.js totalValue audit** — Same precedence bug class as get-value.js (fixed in commit `12e207c`); separate code path needs same fix. Size: S
- **`cards[N].estimatedValue` field rename in get-value response** — Now misleading (carries resolved displayValue, not raw column). Cosmetic. Size: S
- **portfolio_snapshots historical rows have wrong values** — Irrecoverable, accepted as data debt. No action unless backfill mechanism is built.

## Tech debt

- **TradeDesk redesign branch** — Paused before rebase; master has moved significantly. Resume requires rebase + finish phase 2. Size: M
- **`sport` column deprecation** — Keeping both `sport` and `category` columns indefinitely; revisit if migration friction emerges.
- **Node 22 LTS upgrade** — Coordinated bump across Windows + Mac dev environments + AWS Lambda runtime (currently `NODEJS_20_X` per `infrastructure/lib/api-stack.ts:63` — must upgrade in same commit chain to keep local and Lambda runtime aligned) + dependency verification. Triggers (any of): (a) AWS SDK breaks under Node 20, (b) any production dependency drops Node 20 support, (c) Q3 2026 soft deadline regardless. AWS SDK v3 already emits `"upgrade to node >=22"` deprecation warning during backend tests (observed Mac smoke-test 4, 2026-05-14); Node 20 LTS hit maintenance Oct 2025 and is technically past EOL (April 2026) but working fine. Size: S (~2–3 hours).

## Documentation

- **End-to-end workflow diagrams** — Visual documentation of how Collector's Reserve works across multiple stakeholder views. Four diagrams to build sequentially based on need:
  1. **User journey diagram** (signup → portfolio → PA → consignment → transaction). Most valuable near-term — supports external conversations with users, vendors, investors. Build first.
  2. **System architecture diagram** (CDK + Lambda + Aurora + Amplify + CardHedger + Cognito + S3). Build when onboarding a second engineer.
  3. **Business process diagram** (manual concierge flow → automated bounty workflow). Build when bounty MVP design starts.
  4. **Data model diagram** (entity relationships across `cards`, `potential_acquisitions`, `trades`, `consignments`, `users`, `shows`). Build when schema complexity warrants it.

  Trigger for #1: after PA rollout commit 5 ships (PA changes the user journey meaningfully; document the actual post-PA flow, not a stale pre-PA version).

  Size: M (each diagram is ~2–3 hours of design + iteration; full set is ~10–15 hours spread across the right moments).

## Business / brand

- **Trademark "Collector's Reserve"** — Confirm conflict landscape via TESS, file in software/SaaS classes. ~$250–$3K depending on attorney involvement. Size: S
- **Swap personal email in `scp-create-consignment` env vars to `noreply@<domain>`** — Pending Collector's Reserve domain registration. Finding 1 from May 2026 API-key audit. Size: S
- **CardHedger cost optimization** — Extend staleness gates, skip endpoints when data isn't needed, batch where possible. Activate when scale justifies (~500+ users). Size: M

## Completed audits / one-time work

- **2026-05-13: API key / secrets audit** — clean. CDK + Secrets Manager pattern correctly gates credentials. Three findings: defensive `.gitignore` patterns added (`4d50e92`), personal email in Lambda env deferred to post-domain, historical key-name mentions verified as shell-var refs in docs.
