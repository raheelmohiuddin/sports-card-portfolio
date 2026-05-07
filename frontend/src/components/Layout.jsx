import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes } from "aws-amplify/auth";

export default function NavHeader() {
  const { authStatus, signOut } = useAuthenticator((ctx) => [ctx.authStatus, ctx.signOut]);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isAuth = authStatus === "authenticated";

  // Fetch the preferred_username attribute when authenticated. The user object
  // from useAuthenticator gives signInDetails.loginId (email or username they
  // typed), but we want the persisted preferred_username for display.
  const [username, setUsername] = useState(null);
  useEffect(() => {
    if (!isAuth) { setUsername(null); return; }
    let cancelled = false;
    fetchUserAttributes()
      .then((attrs) => {
        if (!cancelled) setUsername(attrs.preferred_username ?? null);
      })
      .catch(() => { if (!cancelled) setUsername(null); });
    return () => { cancelled = true; };
  }, [isAuth]);

  function handleSignOut() {
    signOut();
    navigate("/", { replace: true });
  }

  return (
    <header style={st.header}>
      <div className="container" style={st.inner}>
        <Link to="/" style={st.brand}>
          <span style={st.brandMark}>◆</span>
          <span>Collector's Reserve</span>
        </Link>

        <nav style={st.nav}>
          <NavLink to="/" label="Home" active={pathname === "/"} />
          <NavLink to="/about" label="About" active={pathname === "/about"} />
          {isAuth && (
            <NavLink to="/portfolio" label="My Portfolio" active={pathname === "/portfolio"} badge="BETA" />
          )}
        </nav>

        <div style={st.right}>
          {isAuth ? (
            <UserMenu username={username} onSignOut={handleSignOut} />
          ) : (
            <Link to="/signin" style={st.signInBtn}>Sign In</Link>
          )}
        </div>
      </div>
    </header>
  );
}

// Per-link component so each one tracks its own hover state — needed because
// inline styles can't address :hover.
function NavLink({ to, label, active, badge }) {
  const [hovered, setHovered] = useState(false);
  const dynamicStyle = active ? st.linkActive : (hovered ? st.linkHover : {});
  return (
    <Link
      to={to}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...st.link, ...dynamicStyle }}
    >
      {label}
      {badge && <sup style={st.betaBadge}>{badge}</sup>}
    </Link>
  );
}

// ─── User dropdown menu ──────────────────────────────────────────────
function UserMenu({ username, onSignOut }) {
  const [open, setOpen]       = useState(false);
  const [trigHov, setTrigHov] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!username) return null;

  return (
    <div ref={wrapRef} style={st.userWrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setTrigHov(true)}
        onMouseLeave={() => setTrigHov(false)}
        style={{ ...st.userTrigger, ...(trigHov || open ? st.userTriggerActive : {}) }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span style={st.usernameText}>@{username}</span>
        <Chevron open={open} />
      </button>

      {/* Always rendered; opacity + pointer-events toggled for smooth fade */}
      <div
        role="menu"
        style={{
          ...st.menu,
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0)" : "translateY(-6px)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <MenuItem to="/profile"  icon="👤" label="My Profile"        onClick={() => setOpen(false)} />
        <MenuItem to="/settings" icon="⚙️" label="Account Settings"  onClick={() => setOpen(false)} />
        <div style={st.menuDivider} />
        <MenuButton icon="🚪" label="Sign Out" onClick={() => { setOpen(false); onSignOut(); }} />
      </div>
    </div>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{
        transition: "transform 150ms ease",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function MenuItem({ to, icon, label, onClick }) {
  const [hov, setHov] = useState(false);
  const navigate = useNavigate();

  // Use useNavigate directly + preventDefault on the Link so closing the
  // menu (which sets pointer-events:none on the parent) can't interfere
  // with React Router's internal navigation. Navigate first, close second.
  function handleClick(e) {
    e.preventDefault();
    navigate(to);
    onClick?.();
  }

  return (
    <Link
      to={to}
      role="menuitem"
      onClick={handleClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...st.menuItem, ...(hov ? st.menuItemHover : {}) }}
    >
      <span style={st.menuIcon}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function MenuButton({ icon, label, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...st.menuItem, ...st.menuItemBtn, ...(hov ? st.menuItemHover : {}) }}
    >
      <span style={st.menuIcon}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

const st = {
  header: {
    background: "#0f172a",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    position: "sticky", top: 0, zIndex: 100,
  },
  inner: {
    display: "flex", alignItems: "center",
    height: 60, gap: "2rem",
  },
  brand: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    color: "#fff", fontWeight: 700, fontSize: "1.05rem",
    letterSpacing: "-0.01em", marginRight: "auto",
    textDecoration: "none",
  },
  brandMark: { color: "#f59e0b", fontSize: "0.75rem" },
  nav: { display: "flex", gap: "0.25rem" },
  link: {
    color: "#94a3b8", fontSize: "0.88rem", fontWeight: 500,
    padding: "0.35rem 0.75rem", borderRadius: 6,
    transition: "color 0.15s, background 0.15s",
    textDecoration: "none",
  },
  linkActive: {
    color: "#fff",
    background: "rgba(255,255,255,0.09)",
  },
  linkHover: {
    color: "#fbbf24",
    background: "rgba(245,158,11,0.08)",
  },
  betaBadge: {
    display: "inline-block",
    marginLeft: "0.35rem",
    fontSize: 9,
    padding: "2px 5px",
    borderRadius: 4,
    background: "#f59e0b",
    color: "#000",
    fontWeight: 700,
    letterSpacing: 1,
    verticalAlign: "super",
    lineHeight: 1,
  },
  right: { display: "flex", alignItems: "center", gap: "0.75rem" },

  // ── User dropdown ──
  userWrap: { position: "relative" },
  userTrigger: {
    display: "flex", alignItems: "center", gap: "0.4rem",
    background: "transparent",
    border: "1px solid transparent",
    padding: "0.35rem 0.65rem",
    borderRadius: 999,
    cursor: "pointer",
    color: "#fbbf24",
    transition: "background 0.15s, border-color 0.15s",
    fontFamily: "inherit",
  },
  userTriggerActive: {
    background: "rgba(245,158,11,0.08)",
    borderColor: "rgba(245,158,11,0.28)",
  },
  usernameText: {
    color: "#fbbf24",
    fontSize: "0.85rem", fontWeight: 600,
    letterSpacing: "0.01em",
    fontVariantNumeric: "tabular-nums",
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: 210,
    background: "linear-gradient(160deg, #0f172a 0%, #0a0f1f 100%)",
    border: "1px solid rgba(245,158,11,0.18)",
    borderRadius: 10,
    boxShadow:
      "0 10px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.08), 0 0 28px rgba(245,158,11,0.06)",
    padding: 6,
    transition: "opacity 150ms ease-out, transform 150ms ease-out",
    zIndex: 200,
  },
  menuItem: {
    display: "flex", alignItems: "center", gap: "0.65rem",
    padding: "0.55rem 0.75rem",
    borderRadius: 6,
    color: "#cbd5e1",
    fontSize: "0.85rem", fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
    transition: "background 0.12s, color 0.12s",
    width: "100%",
    textAlign: "left",
  },
  menuItemBtn: {
    background: "transparent", border: "none",
    fontFamily: "inherit",
  },
  menuItemHover: {
    background: "rgba(245,158,11,0.1)",
    color: "#fbbf24",
  },
  menuIcon: { fontSize: "0.95rem", flexShrink: 0 },
  menuDivider: {
    height: 1,
    background: "rgba(255,255,255,0.06)",
    margin: "6px 4px",
  },
  signInBtn: {
    background: "#f59e0b", color: "#0f172a",
    fontSize: "0.85rem", fontWeight: 700,
    padding: "0.4rem 1rem", borderRadius: 6,
    textDecoration: "none",
    letterSpacing: "0.01em",
  },
};
