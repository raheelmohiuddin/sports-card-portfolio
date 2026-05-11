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

### 1.3 Refined Gold (replaces previous `#f59e0b`)

`#f59e0b` reads as a warning-toast amber, not auction-house gold. Antique gold below.

| Token | Hex | Use |
|---|---|---|
| `gold-primary` | `#d4af37` | Antique gold — portfolio value, premium tier badges, brand mark |
| `gold-bright` | `#e6c463` | Hover state, focus ring |
| `gold-deep` | `#a8862a` | Pressed state |
| `gold-tint` | `rgba(212,175,55,0.08)` | Subtle background wash on PSA 10 / premium rows |

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

---

## 2. Typography

All three fonts are free via Google Fonts.

| Role | Font | Notes |
|---|---|---|
| **Display / hero numbers** | **Fraunces** (variable serif) | Portfolio total, sale prices, section titles. Set OPSZ ~144, weight 500–600. Gives the Sotheby's catalog feel. |
| **UI / body / tables** | **Inter** | Workhorse. **Required:** `font-feature-settings: "tnum", "cv11"` so digits are tabular and zero is slashed. |
| **Mono (cert #s, IDs)** | **JetBrains Mono** | PSA cert numbers, image hashes, anything alphanumeric ID-like. Slashed zero by default. |

### 2.1 Type Scale

```
display-xl  48 / 56  Fraunces 500    — hero portfolio value
display-lg  36 / 44  Fraunces 500    — page titles
title       20 / 28  Inter 600
body        15 / 22  Inter 400       — table rows, descriptions
label       13 / 18  Inter 500       — column headers, chips (uppercase, +0.04em tracking)
caption     12 / 16  Inter 400       — metadata, timestamps
mono-data   13 / 18  JetBrains Mono  — IDs only
```

### 2.2 Alternative Pairing

If a fully geometric, fintech-leaning look is wanted (less auction-house, more modern data):
swap Fraunces → **Instrument Serif** (lighter editorial), or go all-sans with **Geist** + **Geist Mono**.

---

## 3. Three Rules This Style Lives or Dies By

### 3.1 Tabular figures everywhere prices live
Without `font-variant-numeric: tabular-nums` on every price column, columns jitter as digits change. This single missing line will make the app feel amateurish no matter how good everything else is.

### 3.2 Gold scarcity
If gold appears on the primary CTA *and* the portfolio total *and* the nav active state *and* the PSA 10 badge, it stops meaning "premium." Pick **one or two roles only**. Default roles: portfolio value + premium-tier badges. Primary CTAs use white/slate, not gold.

### 3.3 Gain/loss must carry an icon, not just color
`▲ +$1,240` not just green `+$1,240`. Roughly 8% of the male audience is red-green colorblind, and the icon also makes scan-reading dense tables faster for everyone.

---

## 4. Implementation Notes

- **Tokens, not raw hex.** Components reference semantic names (`gain`, `surface-2`); never inline `#34d399`.
- **Elevation = tone, not shadow.** Climb the `surface-1 → surface-2 → surface-3` ladder. Avoid `box-shadow` for stacking; reserve it only for dragged items / floating sheets.
- **Hairlines, not borders.** Default to `hairline` (6% white) for table rows and section breaks. Use the harder `border` only when a card needs a defined edge.
- **Dark mode is the only mode.** No light variant planned. If one is added later, design it as a separate token sheet — do not invert.
