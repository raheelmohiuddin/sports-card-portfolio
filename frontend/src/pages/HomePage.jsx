import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";

const FEATURES = [
  {
    icon: "📊",
    title: "Portfolio Valuation",
    desc: "Know exactly what your collection is worth. Real-time market estimates across every card in your portfolio, updated automatically.",
  },
  {
    icon: "📈",
    title: "Price History",
    desc: "Watch your portfolio grow. Track how your total collection value changes over time with detailed historical charts.",
  },
  {
    icon: "💰",
    title: "P&L Tracking",
    desc: "Know your numbers. See your cost basis, current market value, and profit or loss on every single card at a glance.",
  },
  {
    icon: "✦",
    title: "Rarity Tiers",
    desc: "Discover what you really own. Cards are automatically classified into Ghost, Ultra Rare, and Rare tiers based on PSA population data.",
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
        <FloatingCards />
        <div className="container" style={st.heroInner}>
          <p style={st.eyebrow}>
            <span style={st.eyebrowMark}>◆</span> Collector's Reserve
          </p>
          <h1 style={st.heroTitle}>
            Every Card Has a Story.<br />
            <span style={st.heroAccent}>Now It Has a Value.</span>
          </h1>
          <p style={st.heroSub}>
            The only platform built for serious Sports Cards and TCG collectors.
            Rely on professional industry experience to help guide, source, and
            fund some of the world's most elusive cards.
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

      {/* ── Partnership banner ── */}
      <section style={st.partner}>
        <div className="container" style={st.partnerInner}>
          <span style={st.partnerEyebrow}>Exclusive Partner</span>
          <img src="/fanatics-collectibles.png" alt="Fanatics Collectibles" style={st.partnerLogo} />
          <span style={st.partnerSub}>
            Access the world's largest collectibles marketplace
          </span>
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

// ─── Floating cards background ───────────────────────────────────────
const DRIFT_PATTERNS = ["driftA", "driftB", "driftC", "driftD"];
// One card per image — keeps every collection piece on screen exactly once.
const CARD_COUNT = 6;

// 6 collection images cycled across the 14 floating cards (i % 6) so each
// image appears at least twice. Add/remove entries to change the rotation.
const CARD_IMAGES = [
  "/cards/Jordan.jpg",
  "/cards/Ohtani_Gold_10.jfif",
  "/cards/Alcaraz_PSA_10.jfif",
  "/cards/Alcaraz_9_5.jfif",
  "/cards/Ohtani_Refractor_MBA_Black_Diamond.jfif",
  "/cards/Luffy_ST01_MBA_Gold.jfif",
];

function FloatingCards() {
  // Randomise once on mount — useMemo with empty deps gives a stable layout
  // for the lifetime of the page, so cards don't reshuffle on re-render.
  const cards = useMemo(() => (
    Array.from({ length: CARD_COUNT }, (_, i) => {
      const size = 130 + Math.random() * 110; // 130–240 px wide (× 1.4 tall)
      return {
        size,
        image: CARD_IMAGES[i % CARD_IMAGES.length],
        left: Math.random() * 80,                   // keep some right margin so
        top:  Math.random() * 75,                   // larger cards don't clip
        drift:          DRIFT_PATTERNS[i % DRIFT_PATTERNS.length],
        driftDuration:  26 + Math.random() * 24,   // 26–50 s
        driftDelay:     -Math.random() * 30,       // negative → mid-cycle start
        rotateDuration: 90 + Math.random() * 120,  // 90–210 s
        rotateDelay:    -Math.random() * 60,
        rotateDir:      Math.random() > 0.5 ? "normal" : "reverse",
        opacity:        0.75 + Math.random() * 0.25, // 0.75–1.0 — vivid
        shimmer:        Math.random() > 0.4,         // ~60% have shimmer
        shimmerDelay:   -Math.random() * 7,
      };
    })
  ), []);

  return (
    <div style={st.cardsLayer} aria-hidden>
      {cards.map((c, i) => <FloatingCard key={i} card={c} />)}
    </div>
  );
}

function FloatingCard({ card }) {
  // Outer wrapper handles drift; inner wrapper handles rotation. Stacking the
  // animations on different elements keeps each transform single-purpose.
  return (
    <div style={{
      position: "absolute",
      left: `${card.left}%`,
      top:  `${card.top}%`,
      animation: `${card.drift} ${card.driftDuration}s ease-in-out ${card.driftDelay}s infinite`,
      willChange: "transform",
    }}>
      <div style={{
        width:  card.size,
        height: card.size * 1.4, // 5:7 trading-card aspect
        animation: `cardRotate ${card.rotateDuration}s linear ${card.rotateDelay}s infinite ${card.rotateDir}`,
        willChange: "transform",
      }}>
        <div style={{
          position: "relative",
          width: "100%", height: "100%",
          background: "transparent",
          border: "none",
          boxShadow: "none",
          opacity: card.opacity,
        }}>
          <img
            src={card.image}
            alt=""
            style={{
              width: "100%", height: "100%",
              objectFit: "contain",
              display: "block",
              border: "none",
              background: "transparent",
              // `screen` blends each pixel as 255-(255-top)(255-bottom)/255,
              // which makes black pixels (0) effectively pass-through (the
              // hero background shows through), while keeping bright card
              // colours mostly intact. If colours wash out too much, swap
              // to `multiply` instead — that keeps colour saturation but
              // doesn't actually remove black, just blends it into the dark
              // background visually (only works against a dark backdrop).
              mixBlendMode: "screen",
            }}
            draggable={false}
          />
          {card.shimmer && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(120deg, transparent 30%, rgba(245,158,11,0.32) 48%, rgba(255,255,255,0.28) 52%, rgba(245,158,11,0.32) 56%, transparent 75%)",
              backgroundSize: "300% 100%",
              animation: `cardShimmer 7s ease-in-out ${card.shimmerDelay}s infinite`,
              mixBlendMode: "screen",
              pointerEvents: "none",
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

const st = {
  // Floating-cards layer — sits between the radial-gradient noise and
  // the hero text. zIndex 1 puts it above the noise; heroInner is zIndex 2.
  cardsLayer: {
    position: "absolute", inset: 0,
    zIndex: 1,
    pointerEvents: "none",
    overflow: "hidden",
  },

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
  heroInner: { position: "relative", textAlign: "center", zIndex: 2 },
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

  // Partnership banner — sits between hero (dark) and features (white).
  // Subtle gold borders on top + bottom; semi-transparent navy lets the
  // edge between sections feel like a continuation rather than a hard cut.
  partner: {
    background: "rgba(15,23,42,0.8)",
    borderTop:    "1px solid rgba(245,158,11,0.25)",
    borderBottom: "1px solid rgba(245,158,11,0.25)",
    padding: "24px 0",
  },
  // Grid layout: 1fr | auto | 1fr keeps the logo dead-centre regardless of
  // the side text widths. Equal column gaps give even visual spacing.
  partnerInner: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: "2.5rem",
  },
  partnerEyebrow: {
    color: "#f59e0b",
    fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    textAlign: "right",
  },
  partnerLogo: {
    height: 120, width: "auto",
    display: "block",
    borderRadius: 6,
  },
  partnerSub: {
    color: "#94a3b8",
    fontSize: "0.85rem",
    textAlign: "left",
    letterSpacing: "0.01em",
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
