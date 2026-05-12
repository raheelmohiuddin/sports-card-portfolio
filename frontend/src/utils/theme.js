// Shared design tokens — color palette, gradient strings, and a couple of
// reusable style objects. Keep this lean: the value of these tokens is in
// being the single source of truth for colours/gradients that show up in
// many inline-style objects across the app, not in absorbing every style.

// ─── Colour palette ───────────────────────────────────────────────────
export const colors = {
  // Brand gold
  gold:      "#f59e0b",
  goldLight: "#fbbf24",
  goldDark:  "#d97706",

  // Premium hero accent — used ONLY on hero surfaces (Dashboard hero
  // stat, AboutPage headline, HomePage spotlight). Reserved gold per
  // MASTER §1.3. Do not use for general brand accents — use `gold` above.
  //
  // Convention: rgba decompositions of (212,175,55) at various alphas
  // are intentionally inline (matches the brand-gold pattern). Only the
  // hex value is tokenized here. See MASTER §1.3 for context.
  heroGold:  "#d4af37",

  // Dark surface / page background
  bg:       "#0f172a",
  bgDarker: "#0a0f1f",

  // Text — slate ramp, brightest first
  textPrimary:   "#f1f5f9", // headings on dark surfaces
  textSecondary: "#cbd5e1",
  textMuted:     "#94a3b8", // subtitles, slate-400
  textFaint:     "#64748b", // tertiary, slate-500
  textVeryFaint: "#475569", // hint text, dividers

  // Status
  green: "#10b981", // positive P&L, "Top Pop"
  red:   "#f87171", // negative P&L, errors

  // Common border tints used on dark panels
  borderSoft: "rgba(255,255,255,0.06)",
  borderGold: "rgba(245,158,11,0.4)",
};

// ─── Gradients ────────────────────────────────────────────────────────
export const gradients = {
  // Full-bleed page background — used by the protected portfolio + add-card
  // pages to break out of the white container into the dark theme.
  pageDark:
    "radial-gradient(ellipse at top, #0f172a 0%, #070a14 60%, #050811 100%)",

  // The signature gold-tinted panel background — used on every elevated
  // surface inside the dark pages (analytics, insights row, history,
  // detail panels, edit cost modal). 3-stop variant.
  goldPanel:
    "linear-gradient(135deg, rgba(245,158,11,0.04) 0%, rgba(255,255,255,0.02) 50%, rgba(245,158,11,0.03) 100%)",

  // 2-stop variant for slightly less wash (toolbar / cards bar).
  goldPanelSimple:
    "linear-gradient(135deg, rgba(245,158,11,0.04), rgba(255,255,255,0.02))",

  // Solid gold pill — used on primary CTAs and the Add Card button.
  goldPill: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",

  // Admin variants — same dark page, but every "elevated" surface picks up
  // a violet wash so the admin portal reads as a sibling app rather than
  // a section of the collector experience.
  violetPanel:
    "linear-gradient(135deg, rgba(167,139,250,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(167,139,250,0.04) 100%)",
  violetPill:
    "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
};

// Admin-portal accent ramp — kept narrow and distinct from the collector gold.
export const adminColors = {
  accent:      "#a78bfa", // violet 400
  accentLight: "#c4b5fd", // violet 300 — text + hover
  accentDark:  "#7c3aed", // violet 600 — pill bottom
  border:      "rgba(167,139,250,0.28)",
};

// ─── Reusable style objects ──────────────────────────────────────────
// Spread into inline styles: { ...panelStyle, padding: "..." }
export const panelStyle = {
  background: gradients.goldPanel,
  border: `1px solid ${colors.borderSoft}`,
  borderRadius: 16,
};
