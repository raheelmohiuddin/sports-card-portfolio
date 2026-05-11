import { useEffect, useLayoutEffect, useState } from "react";
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
        <div className="container scp-hero-grid" style={st.heroInner}>
          <div className="scp-hero-left">
            <p style={st.eyebrow}>
              <span style={st.eyebrowMark}>◆</span> Collector's Reserve
            </p>
            <h1 style={st.heroTitle}>
              Every Card Has a Story.<br />
              <span style={st.heroAccent}>Now It Has a Value.</span>
            </h1>
            <p className="scp-hero-sub" style={st.heroSub}>
              The only platform built for serious Sports Cards and TCG collectors.
              Rely on professional industry experience to help guide, source, and
              fund some of the world's most elusive cards.
            </p>
            <div className="scp-hero-ctas" style={st.heroCtas}>
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
          <div style={st.heroRight}>
            <Spotlight />
          </div>
        </div>
      </section>

      {/* ── Partnership banner ── */}
      <section style={st.partner}>
        <div className="container scp-partner-inner" style={st.partnerInner}>
          <span className="scp-partner-eyebrow" style={st.partnerEyebrow}>Exclusive Partner</span>
          <img className="scp-partner-logo" src="/fanatics-collectibles.png" alt="Fanatics Collectibles" style={st.partnerLogo} />
          <span className="scp-partner-sub" style={st.partnerSub}>
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
              <div key={f.title} className="scp-feature-card" style={st.featureCard}>
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

      {/* ── Footer ── marketing chrome for visitors only.
           Authenticated users get the global SiteFooter from App.jsx,
           so this branded footer would otherwise duplicate Home/About. */}
      {!isAuth && (
        <footer style={st.footer}>
          <div className="container" style={st.footerInner}>
            <span style={st.footerBrand}>
              <span style={{ color: "#d4af37" }}>◆</span> Collector's Reserve
            </span>
            <nav style={st.footerNav}>
              <Link to="/" style={st.footerLink}>Home</Link>
              <Link to="/about" style={st.footerLink}>About</Link>
              <Link to="/signin" style={st.footerLink}>Sign In</Link>
            </nav>
          </div>
        </footer>
      )}
    </div>
  );
}

// ─── Spotlight Rotation — right column of the hero split ──────────────
// One card at a time gently tilts on Y-axis with a moving specular
// highlight, reading as a slab being slowly inspected. Crossfades to the
// next card every SPOTLIGHT_INTERVAL_MS. Sized and faded via CSS classes
// (.scp-spotlight-stage, .scp-spotlight-card) so media queries can win.

const CARD_IMAGES = [
  "/cards/Jordan.jpg",
  "/cards/Ohtani_Gold_10.jfif",
  "/cards/Alcaraz_PSA_10.jfif",
  "/cards/Alcaraz_9_5.jfif",
  "/cards/Ohtani_Refractor_MBA_Black_Diamond.jfif",
  "/cards/Luffy_ST01_MBA_Gold.jfif",
];

const SPOTLIGHT_INTERVAL_MS = 6000;
const SPOTLIGHT_CROSSFADE_MS = 500;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function Spotlight() {
  const reducedMotion = usePrefersReducedMotion();
  const [idx, setIdx] = useState(0);
  // `prevIdx` is the outgoing card during a crossfade; null when settled.
  const [prevIdx, setPrevIdx] = useState(null);

  useEffect(() => {
    const interval = reducedMotion ? 9000 : SPOTLIGHT_INTERVAL_MS;
    const id = setInterval(() => {
      setIdx((i) => {
        setPrevIdx(i);
        return (i + 1) % CARD_IMAGES.length;
      });
    }, interval);
    return () => clearInterval(id);
  }, [reducedMotion]);

  // Drop the outgoing card from the tree once its fade-out finishes so it
  // stops painting and so the rotation animation gets a clean restart on
  // the next entry (we rely on key= remount for that).
  useEffect(() => {
    if (prevIdx === null) return;
    const t = setTimeout(() => setPrevIdx(null), SPOTLIGHT_CROSSFADE_MS + 50);
    return () => clearTimeout(t);
  }, [prevIdx]);

  return (
    <div className="scp-spotlight-stage" aria-hidden>
      {prevIdx !== null && (
        <SpotlightCard
          key={`exit-${prevIdx}`}
          src={CARD_IMAGES[prevIdx]}
          phase="exit"
          reducedMotion={reducedMotion}
        />
      )}
      <SpotlightCard
        key={`enter-${idx}`}
        src={CARD_IMAGES[idx]}
        phase="enter"
        reducedMotion={reducedMotion}
      />
    </div>
  );
}

function SpotlightCard({ src, phase, reducedMotion }) {
  // Mount in the "off" state, then flip to "on" next frame so the CSS
  // transition fires. Exit cards mount "on" and flip "off" the same way.
  // Base opacity (1.0 desktop / 0.7 mobile) lives in CSS — when `on`, no
  // inline opacity is set so the CSS default wins.
  const [on, setOn] = useState(phase === "exit");
  useLayoutEffect(() => {
    const r = requestAnimationFrame(() => setOn(phase === "enter"));
    return () => cancelAnimationFrame(r);
  }, [phase]);

  const offStyle = on ? undefined : { opacity: 0, transform: "scale(0.96)" };

  return (
    <div className="scp-spotlight-card" style={offStyle}>
      <div style={{
        ...st.spotlightTiltLayer,
        animation: reducedMotion ? "none" : "spotlightTilt 12s ease-in-out infinite",
      }}>
        <img src={src} alt="" style={st.spotlightImage} draggable={false} />
        {!reducedMotion && <div style={st.spotlightShine} />}
      </div>
    </div>
  );
}

const st = {
  // Spotlight stage / card / opacity / transition all live in CSS now
  // (.scp-spotlight-stage, .scp-spotlight-card) so media queries can
  // override per breakpoint.

  // Right column wrapper — flex-center the stage horizontally; grid
  // align-items: center handles the vertical centering of the column.
  heroRight: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spotlightTiltLayer: {
    position: "relative",
    width: "100%", height: "100%",
    transformStyle: "preserve-3d",
    willChange: "transform",
  },
  // Full slab visible — no blend mode. The 50% opacity at the card slot
  // level is what dims the image behind the hero copy.
  spotlightImage: {
    position: "absolute", inset: 0,
    width: "100%", height: "100%",
    objectFit: "contain",
    display: "block",
  },
  // Diegetic specular highlight — a thin angled white sliver that sweeps
  // across the slab in sync with the tilt. No blend mode; just a soft
  // translucent overlay so the slab stays fully visible and crisp.
  spotlightShine: {
    position: "absolute", inset: 0,
    pointerEvents: "none",
    background: "linear-gradient(115deg, transparent 44%, rgba(255,255,255,0.22) 50%, transparent 56%)",
    backgroundSize: "260% 100%",
    animation: "spotlightShine 12s ease-in-out infinite",
  },

  // Hero — flat bg-base, no gradient. Tonal depth comes from surface scale.
  hero: {
    position: "relative",
    background: "#0a0e1a",
    overflow: "hidden",
    // 100% (parent body) instead of 100vw — 100vw includes the scrollbar
    // width on browsers that render persistent scrollbars, which pushes
    // the hero past the viewport edge.
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "7rem 0 6rem",
  },
  // Hero inner: container max-width + grid alignment via .scp-hero-grid.
  // Text alignment now lives on .scp-hero-left so it can flip on mobile.
  heroInner: { position: "relative", zIndex: 2 },
  eyebrow: {
    color: "#d4af37", fontSize: "0.8rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginBottom: "1.25rem",
  },
  eyebrowMark: { marginRight: "0.4rem" },
  heroTitle: {
    fontFamily: "'Fraunces', Georgia, serif",
    color: "#f8fafc", fontSize: "clamp(2.4rem, 5vw, 3.8rem)",
    fontWeight: 500, lineHeight: 1.15,
    letterSpacing: "-0.01em", margin: "0 0 1.5rem",
  },
  // Gold scarcity — accent line drops gold; emphasis carried by serif weight + spacing.
  heroAccent: { color: "#f8fafc" },
  // Horizontal margin and CTA justification come from CSS so the mobile
  // media query (.scp-hero-sub, .scp-hero-ctas) can re-center them.
  heroSub: {
    color: "#94a3b8", fontSize: "clamp(1rem, 2vw, 1.15rem)",
    maxWidth: 520, marginBottom: "2.5rem", lineHeight: 1.65,
  },
  heroCtas: { display: "flex", gap: "1rem", flexWrap: "wrap" },
  // Primary CTA in white/slate — gold reserved for brand mark and premium badges.
  ctaPrimary: {
    background: "#f8fafc", color: "#0a0e1a",
    fontWeight: 700, fontSize: "0.95rem",
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
    borderTop:    "1px solid rgba(255,255,255,0.06)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    padding: "24px 0",
  },
  // Layout (grid 1fr | auto | 1fr on desktop, single-column stack on mobile)
  // is owned by the .scp-partner-inner CSS class in index.css so the
  // media query can swap to a stacked layout below 768px. Inline style
  // kept empty so we don't compete with the CSS rule.
  partnerInner: {},
  // Premium-badge accent — "Exclusive Partner" qualifies for gold-primary.
  partnerEyebrow: {
    color: "#d4af37",
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

  // Features — converted to bg-base. Tonal lift carries the section, not contrast bg.
  features: { background: "#0a0e1a", padding: "5rem 0" },
  sectionEyebrow: {
    textAlign: "center", color: "#94a3b8",
    fontSize: "0.75rem", fontWeight: 600,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginBottom: "0.6rem",
  },
  sectionTitle: {
    fontFamily: "'Fraunces', Georgia, serif",
    textAlign: "center", fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
    fontWeight: 500, color: "#f8fafc",
    letterSpacing: "-0.01em", margin: "0 0 3rem",
  },
  featureGrid: {
    display: "grid",
    // min(230px, 100%) ensures the column never exceeds the available width,
    // so on viewports narrower than 230px the grid still renders one column
    // at full width instead of overflowing horizontally.
    gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))",
    gap: "1.5rem",
  },
  // surface-1 over bg-base creates the card edge through tonal contrast;
  // hairline border adds just enough definition without competing with the data.
  // Hover state (surface-2 #1a2332) lives in index.css under .scp-feature-card.
  featureCard: {
    background: "#0f172a", borderRadius: 12,
    padding: "1.75rem", border: "1px solid rgba(255,255,255,0.06)",
  },
  featureIcon: { fontSize: "1.6rem", display: "block", marginBottom: "1rem" },
  featureTitle: {
    fontSize: "1rem", fontWeight: 600, color: "#f8fafc",
    margin: "0 0 0.5rem",
  },
  featureDesc: { fontSize: "0.87rem", color: "#94a3b8", lineHeight: 1.6, margin: 0 },

  // CTA band — surface-1 with hairline dividers (no hard borders).
  band: {
    background: "#0f172a",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    padding: "3.5rem 0",
  },
  bandInner: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", flexWrap: "wrap", gap: "1.5rem",
  },
  bandTitle: {
    color: "#f8fafc", fontSize: "1.4rem", fontWeight: 600,
    margin: 0, letterSpacing: "-0.01em",
  },
  bandSub: { color: "#64748b", fontSize: "0.88rem", marginTop: "0.3rem" },

  // Footer — surface-1 with hairline divider.
  footer: { background: "#0f172a", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "1.75rem 0" },
  footerInner: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" },
  footerBrand: { color: "#475569", fontSize: "0.85rem", fontWeight: 700 },
  footerNav: { display: "flex", gap: "1.5rem" },
  footerLink: { color: "#475569", fontSize: "0.82rem", textDecoration: "none" },
};
