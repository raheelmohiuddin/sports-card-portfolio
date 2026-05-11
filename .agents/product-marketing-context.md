# Product Marketing Context

*Last updated: 2026-05-10*

## Product Overview
**One-liner:** Collector's Reserve — portfolio tracking, valuation, and trade desk for serious graded-card collectors.

**What it does:** Type in a PSA (or BGS/SGC) cert number and Collector's Reserve pulls the full card data, images, population, and a live market value into your private portfolio. From one dashboard you can track total collection value over time, see cost basis and P&L per card, classify cards into rarity tiers based on population data, propose trades, analyze trades with Claude AI, find local card shows, and (optionally) put cards up for consignment.

**Product category:** Graded sports-card and TCG portfolio tracker / collection management platform. Customers searching for us would type things like "track my PSA collection," "sports card portfolio app," "card collection value tracker."

**Product type:** SaaS web app (React + Vite frontend, AWS Lambda / Aurora backend, hosted on AWS Amplify). Optional marketplace surface via consignments + Fanatics Collectibles partnership.

**Business model:** Free beta today. Planned monetization stack:
- **Monthly subscription tiers** — Basic (free) and Premium (paid). Stripe billing coming soon.
- **Consignment fee** — percentage cut on cards sold through the Fanatics Collectibles consignment flow.
- **TradeDesk transaction fee** — potential fee on confirmed trades (under evaluation).

## Target Audience
**Target companies:** Individual collectors, not companies. The "serious collector" segment — people who already own enough graded cards that spreadsheets and memory have stopped working.

**Decision-makers:** The collector themselves. No procurement, no committee.

**Primary use case:** Knowing what your graded collection is currently worth, end-to-end, without rebuilding a spreadsheet every month.

**Jobs to be done:**
- Tell me what my collection is worth right now, and how that's changed over time.
- Let me look up any card I own by cert number without digging through binders or storage boxes.
- Help me make smarter trade and sell decisions (P&L per card, rarity context, AI second opinion).
- Show me what's nearby and worth attending (card shows) so I can hunt in person.

**Use cases:**
- Daily portfolio check-in — total value, recent movers, P&L.
- Adding new pickups by cert number (PSA / BGS / SGC) right after a show or break.
- Evaluating a trade offer — pulling both sides into TradeDesk, getting a Claude AI take, then confirming.
- Researching whether a specific card is rare enough to chase (Ghost / Ultra Rare / Rare tiers).
- Planning weekend shows — filtering by state, ZIP, radius, travel time.

## Personas
B2C product — one core persona. Sub-segments below if it helps:

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| The Serious Collector | Knowing total value, tracking gains, never losing a card to a forgotten binder | Spreadsheets are stale, prices are scattered across eBay/CardLadder/PSA, no single source of truth | One private portfolio with live values, full PSA/BGS/SGC data, and history charts |
| The Trader | Making winning trades, not lopsided ones | Hard to value a trade fairly when both sides have multiple cards | TradeDesk with side-by-side valuations + Claude AI "analyze this trade" |
| The Show-Goer | Finding the next show that's actually worth driving to | Show calendars are scattered across forums and social | Built-in Shows feature with Near Me, ZIP/radius, Google Maps travel time |
| The Consignor | Selling without doing the listing work | Fees, trust, logistics | Consign through Collector's Reserve to get listed on Fanatics Collectibles — the world's largest sports collectibles marketplace. Admin manages the consignment process end-to-end. |

## Problems & Pain Points
**Core problem:** Serious collectors own enough graded cards that they can no longer answer the basic question "what's my collection worth today?" — and the tools they have (spreadsheets, eBay tabs, PSA website, group chats) don't actually answer it without an hour of manual work.

**Why alternatives fall short:**
- Spreadsheets are stale the moment you close them — no live market data, no PSA pop pull, no images.
- eBay sold-listing searches answer one card at a time, not "my whole collection."
- PSA's site is great for cert lookup but doesn't track ownership, P&L, or rarity context across what you own.
- Generic portfolio apps (cards, sneakers, watches) miss the grading-specific data (cert, population, grade splits).
- CardLadder / 130point give you price data but don't let you own a portfolio with private storage and AI trade analysis.

**What it costs them:**
- Time — hours per month maintaining a spreadsheet.
- Money — bad trades and bad sell decisions when you can't see real cost basis or current comps.
- Confidence — never quite knowing if a trade offer is fair, or whether to chase a specific parallel.

**Emotional tension:** Collectors care about these cards. The frustration is real: you spent thousands building a collection, and you can't answer the simplest questions about it. There's also fear — of getting burned on a trade, of missing a population swing, of not realizing a card is now worth 3× what you paid.

## Competitive Landscape
**Direct:**
- **CollectorsEdge AI** — AI valuation tool. Falls short on full portfolio + trade desk + shows ecosystem; pure valuation surface, not a home for the collection.
- **Market Movers** — price tracking. Falls short on owning the portfolio relationship — it's a data dashboard, not the place a collector tracks what they own.
- **Cardbase** — portfolio tracker. Falls short on AI trade analysis, integrated shows/consignment surface, and the cert-first graded-only focus.
- **CollX** — free app aimed at casual collectors. Falls short on graded-specific data depth, premium positioning, and the serious-collector workflow (cert lookup, P&L per card, rarity tiers).

**Secondary (different solution, same problem):**
- **Spreadsheets (Excel / Google Sheets)** — what most collectors actually use today. Falls short on live data, images, PSA lookup, P&L automation. This is the real competitor for most users.

**Indirect (conflicting approach):**
- **Just sell everything and stop tracking** — some collectors give up and exit. We compete with the "this is too much work" instinct.
- **Trust your dealer / LCS** — outsource valuation. We replace that with self-service confidence.

**Core competitive wedge:** Cert-based, graded-card-only focus. Competitors are either generic card apps (CollX, Cardbase) or single-purpose data tools (Market Movers, CollectorsEdge AI). We're the only one that combines the cert-first workflow with portfolio, trade, shows, and consignment in one premium experience built specifically for graded collectors.

## Differentiation
**Key differentiators:**
- **Cert-first workflow** — type a cert number, get full card data + images in seconds. No manual entry.
- **Multi-grader support** — PSA, BGS, and SGC all flow through the same pipeline (newer than launch — see recent commits).
- **AI trade analysis** — Claude AI can evaluate a proposed trade and explain the call, not just give a number.
- **Rarity tiers grounded in pop data** — Ghost / Ultra Rare / Rare classification driven by PSA population, not vibes.
- **Live market value** — eBay sold listings + CardHedger pricing, not estimates.
- **Integrated shows finder** — Near Me, Google Maps travel time, attendance tracking — built into the same app as your portfolio.
- **Fanatics Collectibles partnership** — users can consign their graded cards through Collector's Reserve to be listed on Fanatics Collectibles, the world's largest sports collectibles marketplace. Admin manages the consignment process end-to-end.
- **Premium "Collector's Reserve" brand** — positioning is aspirational, not generic. Gold-on-navy, "Collector's Reserve" naming, 3D card renderer in detail modal.

**How we do it differently:** We treat the cert number as the primary key. Everything else (images, grades, pop, price, ownership history) hangs off it. That's a small idea with big consequences — it means the app feels instant where competitors feel like data-entry forms.

**Why that's better:** Less manual work, fewer errors, faster portfolio updates, and the data is always consistent with PSA's source of truth.

**Why customers choose us:** It's the only place where look-up, valuation, history, trade analysis, and shows all live in the same private account — built specifically for graded cards.

## Objections
| Objection | Response |
|-----------|----------|
| "I already have a spreadsheet that works fine." | Sure — until you want live values, images, PSA pop data, and P&L per card without a Sunday afternoon of maintenance. Try adding one card by cert number and watch what happens. |
| "How accurate are the market values?" | Pulled from real eBay sold listings and CardHedger pricing — not estimates or guesses. Updated automatically. |
| "Is my collection private? What if your data leaks?" | Each user's portfolio is stored in their own AWS Cognito-authenticated account with encrypted S3 storage. Nothing is shared or public unless you explicitly consign. |
| "Why would I trust an AI to analyze my trade?" | Claude AI explains its reasoning — you see what it's weighing. It's a second opinion, not the final call. |
| "I only have raw cards / I don't grade." | Collector's Reserve is graded-only today — PSA, BGS, SGC. Raw card support isn't on the near-term roadmap. If you're collecting raw, this isn't the right tool yet. |
| "Does this work for TCG (Pokémon, One Piece, etc.) or only sports?" | Any TCG that PSA grades works. Primary categories today are sports cards, Pokémon, and One Piece. Magic the Gathering and other graded TCGs are supported via cert lookup. |

**Anti-persona:**
- **Casual collectors with fewer than ~10 raw cards.** Cert-first workflow doesn't help them; UX is tuned for people who own enough graded cards that tracking actually matters. They'd be happier with CollX or a notes app.
- **Pure investors who don't actually collect.** Speculators looking for an "alt asset" dashboard without any emotional or category-specific stake. Built for serious collectors who already know what PSA grades and population reports mean — not for portfolio-allocation-curious newcomers.

## Switching Dynamics
**Push (what drives them away from current solution):**
- "My spreadsheet is six months out of date and I have no idea what anything is worth anymore."
- "I made a trade last week and I'm still not sure if I got the better end."
- "I keep forgetting which cards I even own."

**Pull (what attracts them to us):**
- One cert number → full card data in seconds.
- A real total-value number, updated daily.
- AI second opinion on trades.
- Premium feel — this looks like an app made for collectors, not an Excel template.

**Habit (what keeps them stuck):**
- Years of muscle memory with a specific spreadsheet layout.
- Trust in their own pricing intuition.
- Reluctance to put their collection list into "yet another app."

**Anxiety (what worries them about switching):**
- Data entry — "do I have to type in 400 cards?" (Answer: no, cert number imports do the work.)
- Privacy — "who sees my collection?" (Answer: only you.)
- Lock-in — "what if the app dies?" Data export isn't built yet, but it's planned. Users own their data.

## Customer Language
**How they describe the problem:**
- "I have no idea what my collection is worth."
- "I hate tracking everything in spreadsheets."
- "I want to know if a trade is actually good for me."
- "I need to know the pop before I buy."
- "I want to know if this card is Ghost tier."

**How they describe us:**
- *(Still collecting verbatim quotes — capture testimonials and Discord/Reddit phrasing as they come in. Copy resonates most when it mirrors how customers actually talk.)*

**Words to use:**
- Collector, serious collector, graded card, cert, cert number, grade, slab, pop, population, parallel, refractor, rookie, RC, comp, sold listing, market value, cost basis, P&L, portfolio, rarity tier, Ghost, Ultra Rare, Rare, TCG, breaks, consign.

**Words to avoid:**
- "Trading card game" written out (use TCG).
- "Investors" / "investment vehicle" — most users self-identify as collectors first, even when behavior is financial.
- Generic SaaS words: "platform," "solution," "synergy," "leverage." Already mostly avoided on the homepage.
- "Users" in user-facing copy — say "collectors."

**Glossary:**
| Term | Meaning |
|------|---------|
| Cert / Cert number | Unique ID assigned by PSA/BGS/SGC when grading a card. Primary key in the app. |
| PSA | Professional Sports Authenticator — largest grading company. |
| BGS | Beckett Grading Services. |
| SGC | Sportscard Guaranty Company. |
| Slab | A graded card sealed in its tamper-evident plastic case. |
| Pop / Population | How many copies of a card exist at each grade level, per the grading company's reports. |
| Rarity tier | App-specific classification (Ghost / Ultra Rare / Rare) derived from pop data. |
| Cost basis | What the user paid for the card (or claims as their cost). |
| P&L | Profit or loss = current market value − cost basis. |
| Consignment | User lists a card with us to sell on their behalf (admin-managed flow). |
| TradeDesk | The in-app surface for proposing, analyzing, and confirming card-for-card trades. |
| Comp / Sold listing | A recent completed eBay sale used as a market reference. |

## Brand Voice
**Tone:** Aspirational and premium, but plainspoken. Confident without being hype-y. Reads like a serious collector talking to another serious collector — not like a fintech app.

**Style:** Direct sentences. Short paragraphs. Concrete examples over abstract claims ("Type in a PSA cert number, get back the full card data and images in seconds" — not "Streamline your collection workflow").

**Personality:** Premium · Trustworthy · Built-by-collectors · Confident · Quietly enthusiastic.

Brand vocabulary uses the "◆" diamond mark and the "Collector's Reserve" name — keep that consistent across new copy.

## Proof Points
**Metrics:**
- **50+ US card shows** in the Shows database, filterable by state, ZIP, radius, and travel time.
- **AI trade analysis powered by Claude** — every trade can be evaluated by Claude with reasoning, not just a number.
- **CardHedger real-time pricing** delivered straight from cert number lookup — no manual comp hunting.
- **PSA population data** attached to every card, driving Ghost / Ultra Rare / Rare classification.

**Customers:** Fanatics Collectibles (exclusive consignment partner) is the strongest external signal today. Named collector / influencer testimonials are still being collected during the beta.

**Testimonials:** *(Capturing during beta — none ready to quote yet.)*

**Value themes:**
| Theme | Proof |
|-------|-------|
| Built for collectors, by collectors | About page: "We're collectors first, engineers second." |
| Data you can trust | eBay sold listings + CardHedger + direct PSA pop pull. |
| Cert-first workflow | One number → full card. No manual data entry. |
| Privacy by default | Per-user Cognito auth, encrypted S3 storage, never shared. |
| AI as a second opinion | Claude AI analyzes trades and explains its reasoning. |
| Premium feel | "Collector's Reserve" naming, gold/navy palette, 3D card renderer. |
| End-to-end | Lookup → portfolio → trade → shows → consign, all in one app. |

## Goals
**Business goal:** Beta-phase North Star is **user signups and portfolio activations**. Build the early base of serious collectors before turning on subscription billing and scaling consignment volume.

**Conversion action:** Sign in → add at least 5 cards by cert number → check portfolio value. That's the activation bar — users who clear it have experienced the cert-first workflow, the live valuation, and the portfolio view, and are dramatically more likely to retain.

**Current metrics:** *(Tracked internally during beta — signup conversion, time-to-first-card-added, % of users hitting the 5-card activation bar, portfolio-value-per-user.)*
