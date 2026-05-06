import { Link } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";

const FEATURES = [
  {
    icon: "🏷️",
    title: "PSA Cert Lookup",
    desc: "Instantly retrieve card details, grade, and images for any PSA-certified card by certificate number.",
  },
  {
    icon: "📊",
    title: "Portfolio Valuation",
    desc: "See the real-time market value of your entire collection in one place, updated from recent eBay sales.",
  },
  {
    icon: "🃏",
    title: "3D Card Viewer",
    desc: "Inspect every card in an immersive Three.js 3D renderer with a magnifying glass zoom on the full-screen view.",
  },
  {
    icon: "✦",
    title: "Population Data",
    desc: "PSA population reports surface rare cards — low-pop gems are highlighted so you know exactly what you hold.",
  },
];

export default function HomePage() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const isAuth = authStatus === "authenticated";

  return (
    <div>
      {/* ── Hero ── */}
      <section style={st.hero}>
        <div style={st.heroNoise} aria-hidden />
        <div className="container" style={st.heroInner}>
          <p style={st.eyebrow}>
            <span style={st.eyebrowMark}>◆</span> Collector's Reserve
          </p>
          <h1 style={st.heroTitle}>
            See Your Collection as<br />
            <span style={st.heroAccent}>a True Portfolio.</span>
          </h1>
          <p style={st.heroSub}>
            Professional portfolio management for sports cards and TCG —
            track grades, market values, and population data across your
            entire graded collection in one place.
          </p>
          <div style={st.heroCtas}>
            {isAuth ? (
              <Link to="/portfolio" style={st.ctaPrimary}>Open My Portfolio →</Link>
            ) : (
              <>
                <Link to="/signin" style={st.ctaPrimary}>Get Started →</Link>
                <Link to="/about" style={st.ctaSecondary}>Learn More</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={st.features}>
        <div className="container">
          <p style={st.sectionEyebrow}>What's inside</p>
          <h2 style={st.sectionTitle}>Everything a serious collector needs</h2>
          <div style={st.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} style={st.featureCard}>
                <span style={st.featureIcon}>{f.icon}</span>
                <h3 style={st.featureTitle}>{f.title}</h3>
                <p style={st.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      {!isAuth && (
        <section style={st.band}>
          <div className="container" style={st.bandInner}>
            <div>
              <h2 style={st.bandTitle}>Ready to track your collection?</h2>
              <p style={st.bandSub}>Sign in and add your first card in under a minute.</p>
            </div>
            <Link to="/signin" style={st.ctaPrimary}>Sign In →</Link>
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <footer style={st.footer}>
        <div className="container" style={st.footerInner}>
          <span style={st.footerBrand}>
            <span style={{ color: "#f59e0b" }}>◆</span> Collector's Reserve
          </span>
          <nav style={st.footerNav}>
            <Link to="/" style={st.footerLink}>Home</Link>
            <Link to="/about" style={st.footerLink}>About</Link>
            {!isAuth && <Link to="/signin" style={st.footerLink}>Sign In</Link>}
          </nav>
        </div>
      </footer>
    </div>
  );
}

const st = {
  // Hero
  hero: {
    position: "relative",
    background: "linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #0f172a 100%)",
    overflow: "hidden",
    padding: "7rem 0 6rem",
  },
  heroNoise: {
    position: "absolute", inset: 0, pointerEvents: "none",
    backgroundImage: "radial-gradient(circle at 70% 20%, rgba(245,158,11,0.08) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(99,102,241,0.06) 0%, transparent 50%)",
  },
  heroInner: { position: "relative", textAlign: "center" },
  eyebrow: {
    color: "#f59e0b", fontSize: "0.8rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginBottom: "1.25rem",
  },
  eyebrowMark: { marginRight: "0.4rem" },
  heroTitle: {
    color: "#fff", fontSize: "clamp(2.4rem, 5vw, 3.8rem)",
    fontWeight: 800, lineHeight: 1.1,
    letterSpacing: "-0.03em", margin: "0 0 1.25rem",
  },
  heroAccent: { color: "#f59e0b" },
  heroSub: {
    color: "#94a3b8", fontSize: "clamp(1rem, 2vw, 1.15rem)",
    maxWidth: 520, margin: "0 auto 2.5rem", lineHeight: 1.65,
  },
  heroCtas: { display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" },
  ctaPrimary: {
    background: "#f59e0b", color: "#0f172a",
    fontWeight: 800, fontSize: "0.95rem",
    padding: "0.75rem 1.75rem", borderRadius: 8,
    textDecoration: "none", letterSpacing: "0.01em",
    display: "inline-block",
  },
  ctaSecondary: {
    background: "rgba(255,255,255,0.07)", color: "#e2e8f0",
    fontWeight: 600, fontSize: "0.95rem",
    padding: "0.75rem 1.75rem", borderRadius: 8,
    textDecoration: "none", border: "1px solid rgba(255,255,255,0.12)",
    display: "inline-block",
  },

  // Features
  features: { background: "#fff", padding: "5rem 0" },
  sectionEyebrow: {
    textAlign: "center", color: "#f59e0b",
    fontSize: "0.75rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginBottom: "0.6rem",
  },
  sectionTitle: {
    textAlign: "center", fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
    fontWeight: 800, color: "#0f172a",
    letterSpacing: "-0.02em", margin: "0 0 3rem",
  },
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "1.5rem",
  },
  featureCard: {
    background: "#f8fafc", borderRadius: 12,
    padding: "1.75rem", border: "1px solid #e2e8f0",
  },
  featureIcon: { fontSize: "1.6rem", display: "block", marginBottom: "1rem" },
  featureTitle: {
    fontSize: "1rem", fontWeight: 700, color: "#0f172a",
    margin: "0 0 0.5rem",
  },
  featureDesc: { fontSize: "0.87rem", color: "#64748b", lineHeight: 1.6, margin: 0 },

  // CTA band
  band: {
    background: "#0f172a",
    borderTop: "1px solid #1e293b",
    borderBottom: "1px solid #1e293b",
    padding: "3.5rem 0",
  },
  bandInner: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", flexWrap: "wrap", gap: "1.5rem",
  },
  bandTitle: {
    color: "#fff", fontSize: "1.4rem", fontWeight: 800,
    margin: 0, letterSpacing: "-0.02em",
  },
  bandSub: { color: "#64748b", fontSize: "0.88rem", marginTop: "0.3rem" },

  // Footer
  footer: { background: "#0f172a", borderTop: "1px solid #1e293b", padding: "1.75rem 0" },
  footerInner: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" },
  footerBrand: { color: "#475569", fontSize: "0.85rem", fontWeight: 700 },
  footerNav: { display: "flex", gap: "1.5rem" },
  footerLink: { color: "#475569", fontSize: "0.82rem", textDecoration: "none" },
};
