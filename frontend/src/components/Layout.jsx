import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";

export default function NavHeader() {
  const { authStatus, signOut, user } = useAuthenticator((ctx) => [ctx.authStatus, ctx.signOut, ctx.user]);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isAuth = authStatus === "authenticated";

  function handleSignOut() {
    signOut();
    navigate("/", { replace: true });
  }

  function navLink(to, label) {
    const active = pathname === to;
    return (
      <Link
        to={to}
        style={{ ...st.link, ...(active ? st.linkActive : {}) }}
      >
        {label}
      </Link>
    );
  }

  return (
    <header style={st.header}>
      <div className="container" style={st.inner}>
        <Link to="/" style={st.brand}>
          <span style={st.brandMark}>◆</span>
          <span>Collector's Reserve</span>
        </Link>

        <nav style={st.nav}>
          {isAuth ? (
            <>
              {navLink("/portfolio", "My Portfolio")}
              {navLink("/add-card", "+ Add Card")}
            </>
          ) : (
            <>
              {navLink("/", "Home")}
              {navLink("/about", "About")}
            </>
          )}
        </nav>

        <div style={st.right}>
          {isAuth ? (
            <>
              <span style={st.email}>{user?.signInDetails?.loginId}</span>
              <button onClick={handleSignOut} style={st.signOutBtn}>Sign Out</button>
            </>
          ) : (
            <Link to="/signin" style={st.signInBtn}>Sign In</Link>
          )}
        </div>
      </div>
    </header>
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
  right: { display: "flex", alignItems: "center", gap: "0.75rem" },
  email: { fontSize: "0.78rem", color: "#64748b" },
  signOutBtn: {
    background: "transparent", border: "1px solid #334155",
    color: "#94a3b8", fontSize: "0.82rem", fontWeight: 500,
    padding: "0.3rem 0.75rem", borderRadius: 6, cursor: "pointer",
  },
  signInBtn: {
    background: "#f59e0b", color: "#0f172a",
    fontSize: "0.85rem", fontWeight: 700,
    padding: "0.4rem 1rem", borderRadius: 6,
    textDecoration: "none",
    letterSpacing: "0.01em",
  },
};
