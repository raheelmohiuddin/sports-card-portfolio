import { Link, useLocation } from "react-router-dom";

export default function Layout({ children, user, signOut }) {
  const { pathname } = useLocation();

  return (
    <div>
      <header style={styles.header}>
        <div className="container" style={styles.headerInner}>
          <span style={styles.brand}>Card Portfolio</span>
          <nav style={styles.nav}>
            <Link style={{ ...styles.navLink, ...(pathname === "/portfolio" ? styles.active : {}) }} to="/portfolio">
              My Cards
            </Link>
            <Link style={{ ...styles.navLink, ...(pathname === "/add-card" ? styles.active : {}) }} to="/add-card">
              + Add Card
            </Link>
          </nav>
          <div style={styles.userArea}>
            <span style={styles.email}>{user?.signInDetails?.loginId}</span>
            <button onClick={signOut} style={styles.signOutBtn}>Sign Out</button>
          </div>
        </div>
      </header>
      <main className="container" style={{ padding: "2rem 1rem" }}>
        {children}
      </main>
    </div>
  );
}

const styles = {
  header: { background: "#1a1a2e", color: "#fff", padding: "0.75rem 0" },
  headerInner: { display: "flex", alignItems: "center", gap: "1.5rem" },
  brand: { fontWeight: 700, fontSize: "1.2rem", marginRight: "auto" },
  nav: { display: "flex", gap: "1rem" },
  navLink: { color: "#ccc", fontWeight: 500, padding: "0.25rem 0.5rem", borderRadius: 4 },
  active: { color: "#fff", background: "rgba(255,255,255,0.15)" },
  userArea: { display: "flex", alignItems: "center", gap: "0.75rem" },
  email: { fontSize: "0.85rem", color: "#aaa" },
  signOutBtn: {
    background: "transparent",
    border: "1px solid #555",
    color: "#ccc",
    padding: "0.3rem 0.75rem",
    borderRadius: 4,
    cursor: "pointer",
  },
};
