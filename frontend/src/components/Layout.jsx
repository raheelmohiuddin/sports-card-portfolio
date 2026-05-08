import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes } from "aws-amplify/auth";

export default function NavHeader() {
  const { authStatus, signOut } = useAuthenticator((ctx) => [ctx.authStatus, ctx.signOut]);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isAuth = authStatus === "authenticated";

  // Fetch the preferred_username, email, and custom:role attributes when
  // authenticated. The user object from useAuthenticator gives signInDetails
  // .loginId (email or username they typed), but we want the persisted
  // values: preferred_username for the @handle display, email as a fallback
  // when preferred_username isn't set yet (new signups land here before the
  // setup-username flow), and custom:role to gate the Admin link.
  const [username, setUsername] = useState(null);
  const [email, setEmail]       = useState(null);
  const [role, setRole]         = useState(null);
  useEffect(() => {
    // TEMP diagnostic for nav-header auth state — remove once stable.
    console.log("nav-header authStatus:", authStatus);
    if (!isAuth) { setUsername(null); setEmail(null); setRole(null); return; }
    let cancelled = false;
    fetchUserAttributes()
      .then((attrs) => {
        if (cancelled) return;
        console.log("nav-header attributes:", attrs);
        setUsername(attrs.preferred_username ?? null);
        setEmail(attrs.email ?? null);
        setRole(attrs["custom:role"] ?? null);
      })
      .catch((err) => {
        console.error("nav-header fetchUserAttributes failed:", err);
        if (!cancelled) { setUsername(null); setEmail(null); setRole(null); }
      });
    return () => { cancelled = true; };
  }, [authStatus, isAuth]);

  function handleSignOut() {
    signOut();
    navigate("/", { replace: true });
  }

  const isMobile = useIsMobile();

  return (
    <header style={st.header}>
      <div className="container" style={st.inner}>
        <Link to="/" style={st.brand}>
          <span style={st.brandMark}>◆</span>
          <span style={st.brandText}>Collector's Reserve</span>
        </Link>

        {isMobile ? (
          <MobileMenu
            pathname={pathname}
            isAuth={isAuth}
            username={username}
            email={email}
            role={role}
            onSignOut={handleSignOut}
          />
        ) : (
          <>
            <nav style={st.nav}>
              <NavLink to="/" label="Home" active={pathname === "/"} />
              <NavLink to="/about" label="About" active={pathname === "/about"} />
              {isAuth && (
                <>
                  <NavLink to="/portfolio" label="My Portfolio" active={pathname === "/portfolio"} badge="BETA" />
                  <NavLink to="/shows"     label="My Shows"     active={pathname.startsWith("/shows")} />
                </>
              )}
            </nav>

            <div style={st.right}>
              {isAuth ? (
                <UserMenu username={username} email={email} role={role} onSignOut={handleSignOut} />
              ) : (
                <Link
                  to="/signin"
                  className="scp-signin-btn"
                  style={{
                    ...st.signInBtn,
                    whiteSpace: "nowrap",
                    minWidth: "fit-content",
                    flexShrink: 0,
                    padding: "8px 12px",
                  }}
                >
                  Sign In
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

// Tracks viewport width so we can swap nav layouts at the breakpoint.
// Only the layout components need this; CSS-media-query alternatives can't
// conditionally render different React subtrees.
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.innerWidth <= breakpoint
  );
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= breakpoint); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

// Per-link component so each one tracks its own hover state — needed because
// inline styles can't address :hover.
function NavLink({ to, label, active, badge }) {
  const [hovered, setHovered] = useState(false);
  const dynamicStyle = active ? st.linkActive : (hovered ? st.linkHover : {});
  return (
    <Link
      to={to}
      className="scp-nav-link"
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
function UserMenu({ username, email, role, onSignOut }) {
  const isAdmin = role === "admin";
  // New signups land here before they've picked a preferred_username (the
  // setup-username flow hasn't run yet). Fall back to email so the dropdown
  // is always reachable — the user can complete username setup from inside.
  const display = username ? `@${username}` : (email ?? "Account");
  const needsUsername = !username;
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
        <span style={st.usernameText}>{display}</span>
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
        {needsUsername && (
          <>
            <MenuItem to="/setup-username" icon="✦" label="Choose Username" onClick={() => setOpen(false)} />
            <div style={st.menuDivider} />
          </>
        )}
        <MenuItem to="/profile"  icon="👤" label="My Profile"        onClick={() => setOpen(false)} />
        <MenuItem to="/settings" icon="⚙️" label="Account Settings"  onClick={() => setOpen(false)} />
        {isAdmin && (
          <>
            <div style={st.menuDivider} />
            <MenuItem to="/admin" icon="🛡️" label="Admin" admin onClick={() => setOpen(false)} />
          </>
        )}
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

function MenuItem({ to, icon, label, onClick, admin }) {
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
      style={{
        ...st.menuItem,
        ...(admin ? st.menuItemAdmin : {}),
        ...(hov ? (admin ? st.menuItemAdminHover : st.menuItemHover) : {}),
      }}
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

// ─── Mobile hamburger menu (≤768px) ──────────────────────────────────
function MobileMenu({ pathname, isAuth, username, email, role, onSignOut }) {
  const isAdmin = role === "admin";
  const needsUsername = isAuth && !username;
  const accountLabel = username ?? email ?? "Account";
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef(null);

  // Close when the route changes (after a link tap)
  useEffect(() => { setOpen(false); }, [pathname]);

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

  function go(to) {
    setOpen(false);
    navigate(to);
  }

  return (
    <div ref={wrapRef} style={st.mobileWrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...st.hamburger, ...(open ? st.hamburgerActive : {}) }}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <Hamburger open={open} />
      </button>

      <div style={{
        ...st.mobileMenu,
        opacity: open ? 1 : 0,
        transform: open ? "translateY(0)" : "translateY(-8px)",
        pointerEvents: open ? "auto" : "none",
      }}>
        <MobileItem to="/"          label="Home"        active={pathname === "/"}          onClick={() => go("/")} />
        <MobileItem to="/about"     label="About"       active={pathname === "/about"}     onClick={() => go("/about")} />
        {isAuth && (
          <>
            <MobileItem
              to="/portfolio"
              label={<>My Portfolio <sup style={st.betaBadge}>BETA</sup></>}
              active={pathname === "/portfolio"}
              onClick={() => go("/portfolio")}
            />
            <MobileItem
              to="/shows"
              label="My Shows"
              active={pathname.startsWith("/shows")}
              onClick={() => go("/shows")}
            />
          </>
        )}

        {isAuth && (
          <>
            <div style={st.menuDivider} />
            <div style={st.mobileUsername}>{username ? `@${username}` : accountLabel}</div>
            {needsUsername && (
              <MobileItem to="/setup-username" icon="✦" label="Choose Username" onClick={() => go("/setup-username")} />
            )}
            <MobileItem to="/profile"  icon="👤" label="My Profile"       onClick={() => go("/profile")} />
            <MobileItem to="/settings" icon="⚙️" label="Account Settings" onClick={() => go("/settings")} />
            {isAdmin && (
              <MobileItem to="/admin" icon="🛡️" label="Admin" admin onClick={() => go("/admin")} />
            )}
            <button
              type="button"
              onClick={() => { setOpen(false); onSignOut(); }}
              style={{ ...st.mobileItem, ...st.mobileItemBtn }}
            >
              <span style={st.menuIcon}>🚪</span>
              <span>Sign Out</span>
            </button>
          </>
        )}

        {!isAuth && (
          <>
            <div style={st.menuDivider} />
            <button
              type="button"
              onClick={() => go("/signin")}
              className="scp-signin-btn"
              style={st.mobileSignInBtn}
            >
              Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MobileItem({ to, icon, label, active, onClick, admin }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...st.mobileItem,
        ...st.mobileItemBtn,
        ...(active ? st.mobileItemActive : {}),
        ...(admin ? st.mobileItemAdmin : {}),
      }}
    >
      {icon && <span style={st.menuIcon}>{icon}</span>}
      <span>{label}</span>
    </button>
  );
}

// Hamburger icon — three lines that morph into an X when open. Pure SVG
// transforms so the animation is GPU-cheap.
function Hamburger({ open }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <line
        x1="3" x2="17"
        y1={open ? "10" : "5"}
        y2={open ? "10" : "5"}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        style={{ transition: "transform 200ms ease, y1 200ms ease, y2 200ms ease",
                 transform: open ? "rotate(45deg)" : "rotate(0)",
                 transformOrigin: "center" }}
      />
      <line
        x1="3" x2="17" y1="10" y2="10"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        style={{ transition: "opacity 200ms ease", opacity: open ? 0 : 1 }}
      />
      <line
        x1="3" x2="17"
        y1={open ? "10" : "15"}
        y2={open ? "10" : "15"}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        style={{ transition: "transform 200ms ease, y1 200ms ease, y2 200ms ease",
                 transform: open ? "rotate(-45deg)" : "rotate(0)",
                 transformOrigin: "center" }}
      />
    </svg>
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
    height: 60, gap: "1rem",
    minWidth: 0, // let flex children shrink without overflowing
  },
  brand: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    color: "#fff", fontWeight: 700, fontSize: "1.05rem",
    letterSpacing: "-0.01em", marginRight: "auto",
    textDecoration: "none",
    // Allow the inner text to truncate before the right-side buttons get
    // squeezed out of view on tiny screens
    minWidth: 0,
    overflow: "hidden",
  },
  brandMark: { color: "#f59e0b", fontSize: "0.75rem", flexShrink: 0 },
  brandText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
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
  right: { display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 },

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
    // Cap long emails (used as fallback when preferred_username isn't set)
    // so the trigger button doesn't expand and break the navbar layout.
    maxWidth: 200,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
  // Admin menu items use a violet accent so they read as "different scope"
  // from the gold-accented collector menu — same shape, distinct identity.
  menuItemAdmin: { color: "#c4b5fd" },
  menuItemAdminHover: {
    background: "rgba(167,139,250,0.12)",
    color: "#ddd6fe",
  },
  mobileItemAdmin: { color: "#c4b5fd" },
  menuIcon: { fontSize: "0.95rem", flexShrink: 0 },
  menuDivider: {
    height: 1,
    background: "rgba(255,255,255,0.06)",
    margin: "6px 4px",
  },

  // ─── Mobile hamburger + dropdown ───
  mobileWrap: { position: "relative", marginLeft: "auto" },
  hamburger: {
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 999,
    width: 40, height: 40,
    color: "#fbbf24",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    padding: 0,
  },
  hamburgerActive: {
    background: "rgba(245,158,11,0.08)",
    borderColor: "rgba(245,158,11,0.28)",
  },
  mobileMenu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: 240,
    maxWidth: "calc(100vw - 2rem)",
    background: "linear-gradient(160deg, #0f172a 0%, #0a0f1f 100%)",
    border: "1px solid rgba(245,158,11,0.18)",
    borderRadius: 10,
    boxShadow:
      "0 10px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.08), 0 0 28px rgba(245,158,11,0.06)",
    padding: 6,
    transition: "opacity 150ms ease-out, transform 150ms ease-out",
    zIndex: 200,
  },
  mobileItem: {
    display: "flex", alignItems: "center", gap: "0.65rem",
    padding: "0.7rem 0.85rem",
    borderRadius: 6,
    color: "#cbd5e1",
    fontSize: "0.92rem", fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    transition: "background 0.12s, color 0.12s",
  },
  mobileItemBtn: {
    background: "transparent", border: "none",
    fontFamily: "inherit",
  },
  mobileItemActive: {
    color: "#f59e0b",
    background: "rgba(245,158,11,0.08)",
  },
  mobileUsername: {
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    color: "#fbbf24",
    padding: "0.5rem 0.85rem 0.25rem",
  },
  mobileSignInBtn: {
    display: "block", width: "calc(100% - 8px)",
    margin: "4px",
    background: "#f59e0b", color: "#0f172a",
    border: "none", borderRadius: 6,
    fontSize: "0.92rem", fontWeight: 800,
    padding: "0.7rem 1rem",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.01em",
  },
  signInBtn: {
    background: "#f59e0b", color: "#0f172a",
    fontSize: "0.85rem", fontWeight: 700,
    padding: "0.4rem 1rem", borderRadius: 6,
    textDecoration: "none",
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
};
