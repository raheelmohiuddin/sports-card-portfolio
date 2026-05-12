import { Link } from "react-router-dom";

const PILLARS = [
  {
    title: "Built for Collectors",
    desc: "We designed every feature around how serious collectors actually work — looking up certs on the PSA website, tracking grades across brands, watching population data for the cards that matter most.",
  },
  {
    title: "Data You Can Trust",
    desc: "Market values come from real eBay sold listings, not estimates. PSA population data is pulled directly so you always know where your card ranks against every other copy in existence.",
  },
  {
    title: "Privacy First",
    desc: "Your collection belongs to you. Every card, image, and valuation is stored in your private account and never shared. We use AWS Cognito for authentication and S3 for encrypted image storage.",
  },
];

export default function AboutPage() {
  return (
    <div>
      {/* ── Page hero ── */}
      <section style={st.hero}>
        <div className="container" style={st.heroInner}>
          <p style={st.eyebrow}><span style={st.mark}>◆</span> About</p>
          <h1 style={st.heroTitle}>We built the app<br />we always wanted.</h1>
          <p style={st.heroSub}>
            Collector's Reserve started as a personal project to solve a simple
            problem: there was no clean, modern tool to manage a graded sports
            card collection from lookup to valuation.
          </p>
        </div>
      </section>

      {/* ── Story ── */}
      <section style={st.story}>
        <div className="container scp-about-story-grid">
          <div style={st.storyText}>
            <h2 style={st.storyTitle}>The story</h2>
            <p style={st.storyP}>
              Every collector knows the frustration: you have dozens of PSA-graded
              cards spread across binders and storage boxes, no clear picture of what
              the collection is worth, and no way to quickly look up what you own
              without digging through spreadsheets.
            </p>
            <p style={st.storyP}>
              Collector's Reserve replaces all of that. Type in a PSA cert number,
              get back the full card data and images in seconds. Add it to your
              portfolio, and the app immediately reflects its market value. Open the
              detail modal and inspect it in 3D. That's the experience we built.
            </p>
            <p style={st.storyP}>
              We're collectors first, engineers second. Every decision — from the
              AI-powered card edge texture analysis to the real-time eBay pricing —
              came from asking what would actually make managing a collection better.
            </p>
          </div>
          <div style={st.statGrid}>
            {[
              ["PSA", "Certified data"],
              ["3D", "Card renderer"],
              ["Real-time", "Market pricing"],
              ["Private", "Cloud storage"],
            ].map(([val, label]) => (
              <div key={label} style={st.stat}>
                <span style={st.statVal}>{val}</span>
                <span style={st.statLabel}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pillars ── */}
      <section style={st.pillars}>
        <div className="container">
          <h2 style={st.pillarsTitle}>What we stand for</h2>
          <div style={st.pillarsGrid}>
            {PILLARS.map((p) => (
              <div key={p.title} style={st.pillar}>
                <h3 style={st.pillarTitle}>{p.title}</h3>
                <p style={st.pillarDesc}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={st.cta}>
        <div className="container" style={{ textAlign: "center" }}>
          <h2 style={st.ctaTitle}>Start tracking your collection today.</h2>
          <p style={st.ctaSub}>Free to use. No credit card required.</p>
          <Link to="/signin" style={st.ctaBtn}>Get Started →</Link>
        </div>
      </section>
    </div>
  );
}

const st = {
  // Hero — flat bg-base, no gradient. Inter Display (opsz 32) carries the
  // editorial lead-in; eyebrow is the only gold on the page besides the brand mark.
  hero: {
    background: "#0a0e1a",
    padding: "6rem 0 5rem",
  },
  heroInner: { maxWidth: 720 },
  eyebrow: {
    color: "#d4af37", fontSize: "0.78rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    marginBottom: "1.5rem",
  },
  mark: { marginRight: "0.45rem" },
  heroTitle: {
    fontFamily: "'Inter', sans-serif",
    fontVariationSettings: "'opsz' 32",
    color: "#f8fafc",
    fontSize: "clamp(2.2rem, 4.5vw, 3.4rem)",
    fontWeight: 600, lineHeight: 1.15,
    letterSpacing: "-0.025em",
    margin: "0 0 1.5rem",
  },
  heroSub: {
    color: "#cbd5e1", fontSize: "1.05rem",
    lineHeight: 1.7, margin: 0, maxWidth: 580,
  },

  // Story — same bg-base; hairline at the top reads as a section break
  // without alternating bg colors (Editorial Dark = one continuous surface).
  // Layout (1fr/auto desktop, stacked mobile) lives on .scp-about-story-grid
  // in index.css since inline styles can't host media queries.
  story: {
    background: "#0a0e1a",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    padding: "5rem 0",
  },
  storyText: { maxWidth: 600 },
  storyTitle: {
    fontFamily: "'Inter', sans-serif",
    fontVariationSettings: "'opsz' 32",
    fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
    fontWeight: 600, color: "#f8fafc",
    letterSpacing: "-0.01em",
    margin: "0 0 1.75rem",
  },
  storyP: {
    fontSize: "1rem",
    color: "#cbd5e1",
    lineHeight: 1.8,
    marginBottom: "1.25rem",
  },

  // Stat block — catalog-style data showcase. Surface-1 cards with hairline
  // borders, Inter Display values in text-primary (deliberately not gold;
  // gold scarcity rule keeps gold for the brand mark only on this page),
  // tabular-nums so digit changes don't jitter the layout.
  statGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1rem",
    minWidth: 240,
  },
  stat: {
    background: "#0f172a",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
    padding: "1.5rem 1.25rem",
    textAlign: "center",
  },
  statVal: {
    display: "block",
    fontFamily: "'Inter', sans-serif",
    fontVariationSettings: "'opsz' 32",
    fontSize: "1.4rem",
    fontWeight: 700,
    color: "#f8fafc",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.025em",
  },
  statLabel: {
    display: "block",
    fontSize: "0.7rem", fontWeight: 600,
    color: "#94a3b8",
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginTop: "0.55rem",
  },

  // Pillars — same continuous bg-base. Hairline section break top.
  pillars: {
    background: "#0a0e1a",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    padding: "5rem 0",
  },
  pillarsTitle: {
    fontFamily: "'Inter', sans-serif",
    fontVariationSettings: "'opsz' 32",
    fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
    fontWeight: 600, color: "#f8fafc",
    letterSpacing: "-0.01em",
    margin: "0 0 3rem",
    textAlign: "center",
  },
  pillarsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "1.5rem",
  },
  pillar: {
    background: "#0f172a",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.06)",
    padding: "1.85rem 1.75rem",
  },
  pillarTitle: {
    fontSize: "1.05rem", fontWeight: 600,
    color: "#f8fafc",
    margin: "0 0 0.7rem",
    letterSpacing: "-0.005em",
  },
  pillarDesc: {
    fontSize: "0.9rem",
    color: "#94a3b8",
    lineHeight: 1.7,
    margin: 0,
  },

  // CTA band — surface-1 lift over the page bg. White button (NOT gold) per
  // gold-scarcity rule: gold is reserved for brand-mark + premium tiers.
  cta: {
    background: "#0f172a",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    padding: "5rem 0",
  },
  ctaTitle: {
    fontFamily: "'Inter', sans-serif",
    fontVariationSettings: "'opsz' 32",
    color: "#f8fafc",
    fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    margin: "0 0 0.6rem",
  },
  ctaSub: {
    color: "#94a3b8",
    fontSize: "0.92rem",
    marginBottom: "2.25rem",
  },
  ctaBtn: {
    background: "#f8fafc", color: "#0a0e1a",
    fontWeight: 700, fontSize: "0.95rem",
    padding: "0.75rem 1.75rem", borderRadius: 8,
    textDecoration: "none",
    letterSpacing: "0.01em",
    display: "inline-block",
  },
};
