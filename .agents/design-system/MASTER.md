# Collector's Reserve — Design System (MASTER)

> Source of truth for all UI work. Page-specific overrides live in `.agents/design-system/pages/<page>.md` and take precedence over this file when present.

**Style:** Editorial Dark — Bloomberg Terminal × Sotheby's auction catalog.
Flat surfaces, tonal depth (no shadows for hierarchy), hairline dividers, restrained antique-gold accents, serif display + sans data. Audience: serious adult collectors who value premium feel, data density, and professional aesthetics.

---

## 1. Color Tokens

All foreground/background pairs verified at ≥4.5:1 on `bg-base` (WCAG AA).

### 1.1 Surfaces (tonal elevation, not shadows)

| Token | Hex | Use |
|---|---|---|
| `bg-base` | `#0a0e1a` | App background ("obsidian", slightly deeper than slate-900) |
| `surface-1` | `#0f172a` | Cards, table rows |
| `surface-2` | `#1a2332` | Raised: modals, hover row, popovers |
| `surface-3` | `#22304a` | Tooltips, highest elevation |
| `hairline` | `rgba(255,255,255,0.06)` | Dividers, table row separators |
| `border` | `#1f2937` | Card edges when an explicit edge is needed |

### 1.2 Text

| Token | Hex | Use |
|---|---|---|
| `text-primary` | `#f8fafc` | Headings, key data (not pure white — less harsh on dark) |
| `text-secondary` | `#cbd5e1` | Body |
| `text-muted` | `#94a3b8` | Labels, axis ticks, metadata |
| `text-subtle` | `#64748b` | Disabled, captions |

### 1.3 Brand Gold — A Two-Gold System

The app uses two distinct golds with clearly-separated roles. The
decision rule is hero-surface scope.

**Brand gold: `#f59e0b`** (amber-500). The everyday brand accent.
Used on the brand mark, primary CTAs, tier badges for Ultra Rare,
Consign affordances, accents throughout app pages, and as the
canonical brand identity wherever the product references itself.

| Token | Hex | Use |
|---|---|---|
| `gold` | `#f59e0b` | Primary brand accent |
| `goldLight` | `#fbbf24` | Hover, lighter shade |
| `goldDark` | `#d97706` | Pressed, deeper shade |
| `borderGold` | `rgba(245,158,11,0.4)` | Border tint on dark panels |

**Hero gold: `#f0c651`** (sunlit gold). Reserved for the single
most important element on a hero surface — the centerpiece moment
of a page. Currently consumed on three surfaces only: the Dashboard
"Total Portfolio Value" hero stat, the AboutPage headline, and the
HomePage spotlight. Adding new uses requires the surface to qualify
as a hero / centerpiece (see decision rule below).

| Token | Hex | Use |
|---|---|---|
| `heroGold` | `#f0c651` | Hero surface accent (rare, scarcity rule applies) |

Rgba decompositions of `(240,198,81)` at various alphas (chart cursors, hero borders, focus rings, hover states) are intentionally inline rather than tokenized — matching the same convention used for brand gold, where only the hex value is tokenized.

**Decision rule for future surfaces.** New code adding a gold accent
uses `colors.gold` (brand) by default. Use `colors.heroGold` ONLY if
the surface is a hero stat or page centerpiece — the single most
important element on its page, intended to feel reverent. When in
doubt, default to brand gold. Do not introduce a third gold value
without a doc update.

**Design history.** This section previously prescribed antique gold
as a wholesale replacement for amber. The codebase was reconciled to
antique in three commits, then visual review showed antique read as
muted and dated on operational surfaces (Shows, Add Card, profile,
etc.); amber's higher saturation read as more premium in those
contexts. The reconciliation was reverted. The hero-only uses of
antique that had been adopted in earlier Editorial Dark refactors
(Dashboard hero, AboutPage, HomePage) were preserved and now form
the basis of the two-gold system documented above. Reference
commits: see git log around 2026-05-11 for the swap, revert, and
formalization.

Initial heroGold value was `#d4af37` (antique gold). Visual review
on the Dashboard hero stat showed the antique read as dull against
the dark navy surface — desaturated and recessive when the hero
number should feel radiant. Token value updated to `#f0c651`
(sunlit gold) for higher luminosity while preserving the warm,
luxury-metal character that distinguishes hero gold from brand
amber. Rgba decompositions in PortfolioPage.jsx updated to the new
rgb triple (240,198,81) in the same commit.

### 1.4 Semantic — Gain / Loss / Info

Pair every gain/loss color with an icon (▲/▼). Never rely on color alone.

| Token | Hex | Use |
|---|---|---|
| `gain` | `#34d399` | ▲ Price up / portfolio gain (emerald-400, less neon than 500) |
| `gain-bg` | `rgba(52,211,153,0.10)` | Cell highlight |
| `loss` | `#f87171` | ▼ Price down (red-400, gentler on dark than red-500) |
| `loss-bg` | `rgba(248,113,113,0.10)` | Cell highlight |
| `info` | `#60a5fa` | Links, info chips |
| `grade-elite` | `#a78bfa` | PSA 10 / BGS 10 Pristine — distinct from gold so two tiers read |

### 1.5 Valuation confidence + method

Cards now carry a `price-estimate`-derived headline value (`estimate_price`)
alongside the comps-derived `estimated_value`. The estimate ships with two
metadata fields that drive UI behavior.

**Confidence tiers** — the only confidence-derived UI signal. Three tiers
mapped from the raw 0.0–1.0 `estimate_confidence` value:

| Tier | Threshold | Color token | Example use |
|---|---|---|---|
| Low | confidence < 0.5 | `text-muted` (#94a3b8) | Card has limited recent comps; estimate is interpolated |
| Medium | 0.5 ≤ confidence < 0.75 | `text-secondary` (#cbd5e1) | Some recent direct sales; estimate is reasonable |
| High | confidence ≥ 0.75 | `gain` (#34d399) | Multiple recent direct sales; estimate is trusted |

Render the tier as the literal word ("Low" / "Medium" / "High") in a small
slate-toned chip with the color from the table above, **never the raw
0.4017-style number**. The number isn't useful UX; the tier word answers
"how much should I trust this?".

**Method values** — stored on the card payload, **not displayed** in v1.
Three observed values from CardHedger:

| Method | Meaning |
|---|---|
| `direct` | At least one direct PSA-grade sale in the recent window. Most reliable. |
| `card_interpolation` | Estimate derived from prices at adjacent grades (e.g. PSA 9 + Raw used to infer PSA 10). Less reliable; usually correlates with low confidence. |
| `correlated` | Hypothetical — not yet observed, listed for completeness. Likely uses sales of similar (non-same) cards. |

**`estimate_freshness_days`** — also stored, also not displayed in v1.
Indicates the age of the most recent comp the estimate is anchored on.
Useful as a future signal ("data is N months stale") but not surfaced
until we see a concrete UX need.

**Variant** — when `card.variant` is present, the card title renders the
variant string inline after the brand/set name, separated by ` · `:
> "2017 Panini Prizm Football · Blue Wave"

When `variant` is null (cards added pre-migration that haven't been
backfilled, or cards CardHedger doesn't tag with a variant), the suffix is
omitted entirely. Don't render "·" separator without a value.

---

## 2. Typography

One family, served from Google Fonts. Inter at `opsz` 32 is "Inter Display" —
no separate Display family file needed. Mono is a system fallback chain.

| Role | Font | Notes |
|---|---|---|
| **Display / hero numbers** | **Inter Display** | Inter at the variable-axis upper bound. Set `font-variation-settings: 'opsz' 32` to engage the display optical cut (tighter, more authoritative than body Inter). Weight 700 for portfolio total; weight 600 for section headings. |
| **UI / body / tables** | **Inter** | Same family, default opsz (auto-selected by browser at small sizes). **Required:** `font-feature-settings: "tnum", "cv11"` so digits are tabular and zero is slashed. |
| **Mono (cert #s, IDs)** | system mono | `'JetBrains Mono', 'Fira Code', monospace` — uses the user's installed mono if available, otherwise the platform's default monospace. Not loaded from Google to keep the network payload minimal. |

### 2.1 Type Scale

```
display-xl  48 / 56  Inter Display 700  opsz 32  -0.03em   — hero portfolio value (financial-terminal density)
display-lg  36 / 44  Inter Display 600  opsz 32  -0.025em  — hero/page titles
title       20 / 28  Inter Display 600  opsz 32  -0.01em   — section headings (looser tracking at smaller display sizes)
body        15 / 22  Inter 400          (auto)             — table rows, descriptions
label       13 / 18  Inter 500          (auto)   +0.04em   — column headers, chips (uppercase)
caption     12 / 16  Inter 400          (auto)             — metadata, timestamps
mono-data   13 / 18  system mono        (fallback)         — IDs only (cert numbers, hashes)
```

**Why Inter at opsz 32 instead of a separate Display font?** Inter v4 has a
variable optical-size axis. At `opsz 32` the cut is tighter, with shorter
extenders and less x-height contrast than body Inter — purpose-built for
display sizes. Same family, same network request, same vertical metrics.

### 2.2 Tracking by tier

Tighter at larger sizes (a financial-terminal convention):

- Portfolio total (≥ 2.6rem):  **-0.03em**
- Hero / page titles (≥ 2rem): **-0.025em**
- Section headings (~ 1.4rem): **-0.01em**
- Body / labels:               default (no override)

### 2.3 Alternative Pairings

If the design ever wants a serif display back: **IBM Plex Serif** (free,
architectural, less literary than Fraunces) is the closest match to the
Editorial Dark intent. **Playfair Display** for hero-only didone luxury.

---

## 3. Three Rules This Style Lives or Dies By

### 3.1 Tabular figures everywhere prices live
Without `font-variant-numeric: tabular-nums` on every price column, columns jitter as digits change. This single missing line will make the app feel amateurish no matter how good everything else is.

### 3.2 Hero-gold scarcity
With the two-gold system formalized in §1.3, scarcity discipline applies to **hero gold** (`#d4af37`) only. If hero gold appears on more than the centerpiece moment of a page, it stops meaning "premium" — keep it to the single most important element per surface (Dashboard hero stat, AboutPage headline, HomePage spotlight). Brand gold (`#f59e0b`) is used freely per §1.3; its semantic role IS the everyday brand accent, so scarcity rules don't apply to it.

### 3.3 Gain/loss must carry an icon, not just color
`▲ +$1,240` not just green `+$1,240`. Roughly 8% of the male audience is red-green colorblind, and the icon also makes scan-reading dense tables faster for everyone.

---

## 4. Implementation Notes

- **Tokens, not raw hex.** Components reference semantic names (`gain`, `surface-2`); never inline `#34d399`.
- **Elevation = tone, not shadow.** Climb the `surface-1 → surface-2 → surface-3` ladder. Avoid `box-shadow` for stacking; reserve it only for dragged items / floating sheets.
- **Hairlines, not borders.** Default to `hairline` (6% white) for table rows and section breaks. Use the harder `border` only when a card needs a defined edge.
- **Dark mode is the only mode.** No light variant planned. If one is added later, design it as a separate token sheet — do not invert.
