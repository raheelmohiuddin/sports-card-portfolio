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
        <div className="container" style={st.storyGrid}>
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
  // Hero
  hero: {
    background: "linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
    padding: "5rem 0 4rem",
  },
  heroInner: { maxWidth: 640 },
  eyebrow: {
    color: "#f59e0b", fontSize: "0.75rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem",
  },
  mark: { marginRight: "0.4rem" },
  heroTitle: {
    color: "#fff", fontSize: "clamp(2rem, 4vw, 3rem)",
    fontWeight: 800, lineHeight: 1.15,
    letterSpacing: "-0.03em", margin: "0 0 1rem",
  },
  heroSub: {
    color: "#94a3b8", fontSize: "1.05rem",
    lineHeight: 1.65, margin: 0, maxWidth: 540,
  },

  // Story
  story: { background: "#fff", padding: "5rem 0" },
  storyGrid: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "4rem", alignItems: "start",
    "@media(max-width:640px)": { gridTemplateColumns: "1fr" },
  },
  storyText: { maxWidth: 560 },
  storyTitle: {
    fontSize: "1.6rem", fontWeight: 800,
    color: "#0f172a", letterSpacing: "-0.02em",
    margin: "0 0 1.25rem",
  },
  storyP: {
    fontSize: "0.95rem", color: "#475569",
    lineHeight: 1.75, marginBottom: "1rem",
  },
  statGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr",
    gap: "1.25rem", minWidth: 220,
  },
  stat: {
    background: "#f8fafc", borderRadius: 10,
    border: "1px solid #e2e8f0",
    padding: "1.25rem", textAlign: "center",
  },
  statVal: { display: "block", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a" },
  statLabel: { display: "block", fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.25rem" },

  // Pillars
  pillars: { background: "#f8fafc", borderTop: "1px solid #e2e8f0", padding: "5rem 0" },
  pillarsTitle: {
    fontSize: "1.6rem", fontWeight: 800, color: "#0f172a",
    letterSpacing: "-0.02em", margin: "0 0 2.5rem",
    textAlign: "center",
  },
  pillarsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "1.5rem",
  },
  pillar: {
    background: "#fff", borderRadius: 12,
    border: "1px solid #e2e8f0", padding: "1.75rem",
  },
  pillarTitle: {
    fontSize: "1rem", fontWeight: 700, color: "#0f172a",
    margin: "0 0 0.6rem",
  },
  pillarDesc: { fontSize: "0.87rem", color: "#64748b", lineHeight: 1.65, margin: 0 },

  // CTA
  cta: { background: "#0f172a", padding: "5rem 0" },
  ctaTitle: {
    color: "#fff", fontSize: "clamp(1.5rem, 3vw, 2rem)",
    fontWeight: 800, letterSpacing: "-0.02em",
    margin: "0 0 0.5rem",
  },
  ctaSub: { color: "#64748b", fontSize: "0.9rem", marginBottom: "2rem" },
  ctaBtn: {
    background: "#f59e0b", color: "#0f172a",
    fontWeight: 800, fontSize: "0.95rem",
    padding: "0.75rem 1.75rem", borderRadius: 8,
    textDecoration: "none", display: "inline-block",
  },
};
