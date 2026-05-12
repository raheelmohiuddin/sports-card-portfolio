import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getAdminStats, getAdminCards } from "../services/api.js";
import { colors, adminColors, gradients } from "../utils/theme.js";
import { effectiveValue } from "../utils/portfolio.js";

// ─── Admin Dashboard ─────────────────────────────────────────────────
// Top-level /admin landing page. Four stat tiles + a full all-cards table
// across every user. Violet accent system-wide so the portal reads as a
// distinct app rather than a section of the collector experience.
export default function AdminPage() {
  const [stats, setStats] = useState(null);
  const [cards, setCards] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAdminStats(), getAdminCards()])
      .then(([s, c]) => {
        if (cancelled) return;
        setStats(s); setCards(c);
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load admin data"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={st.page}>
      <AdminTopNav />
      <div className="container">
        <header style={st.header}>
          <p style={st.eyebrow}><span style={st.eyebrowMark}>◆</span> Collector's Reserve · Admin</p>
          <h1 style={st.title}>Operations</h1>
          <p style={st.sub}>Aggregate view across every collector on the platform.</p>
        </header>

        {error && <div style={st.errorBanner}>{error}</div>}

        <section style={st.tileRow}>
          <StatTile label="Total Users"        value={stats ? stats.totalUsers.toLocaleString()                            : "—"} />
          <StatTile label="Total Cards"        value={stats ? stats.totalCards.toLocaleString()                            : "—"} />
          <StatTile label="Total Value"        value={stats ? fmt(stats.totalValue)                                        : "—"} accent />
          <StatTile label="Open Consignments"  value={stats ? stats.openConsignments.toLocaleString()                      : "—"}
                    href="/admin/consignments" />
        </section>

        <section style={st.tableSection}>
          <div style={st.sectionHead}>
            <h2 style={st.sectionTitle}>All Cards</h2>
            <span style={st.sectionCount}>{cards?.length ?? 0} cards</span>
          </div>
          <div style={st.tableScroll}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>First</th>
                  <th style={st.th}>Last</th>
                  <th style={st.th}>Email</th>
                  <th style={st.th}>Card</th>
                  <th style={{ ...st.th, ...st.thRight }}>Grade</th>
                  <th style={st.th}>Cert #</th>
                  <th style={{ ...st.th, ...st.thRight }}>Estimated</th>
                  <th style={st.th}>Date Added</th>
                </tr>
              </thead>
              <tbody>
                {cards?.length === 0 && (
                  <tr><td colSpan={8} style={st.tdEmpty}>No cards yet.</td></tr>
                )}
                {cards?.map((c) => {
                  const cardLabel = [c.year, c.brand, c.playerName].filter(Boolean).join(" ") || "—";
                  return (
                    <tr key={c.id} style={st.row}>
                      <td style={st.td}>{c.user.givenName  ?? "—"}</td>
                      <td style={st.td}>{c.user.familyName ?? "—"}</td>
                      <td style={st.tdMono}>{c.user.email}</td>
                      <td style={st.tdStrong}>{cardLabel}</td>
                      <td style={{ ...st.td, ...st.tdRight }}>{c.grade ?? "—"}</td>
                      <td style={st.tdMono}>{c.certNumber ?? "—"}</td>
                      <td style={{ ...st.td, ...st.tdRight, ...st.tdValue }}>{fmt(effectiveValue(c))}</td>
                      <td style={st.td}>{fmtDate(c.addedAt)}</td>
                    </tr>
                  );
                })}
                {!cards && (
                  <tr><td colSpan={8} style={st.tdEmpty}>Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Admin sub-nav (used on every /admin page) ─────────────────────
export function AdminTopNav() {
  const { pathname } = useLocation();
  return (
    <div style={st.subnav}>
      <div className="container" style={st.subnavInner}>
        <SubLink to="/admin" label="Dashboard" active={pathname === "/admin"} />
        <SubLink to="/admin/consignments" label="Consignments" active={pathname.startsWith("/admin/consignments")} />
      </div>
    </div>
  );
}

function SubLink({ to, label, active }) {
  return (
    <Link to={to} style={{ ...st.sublink, ...(active ? st.sublinkActive : {}) }}>
      {label}
    </Link>
  );
}

function StatTile({ label, value, accent, href }) {
  const content = (
    <>
      <div style={st.tileLabel}>{label}</div>
      <div style={{ ...st.tileValue, ...(accent ? st.tileValueAccent : {}) }}>{value}</div>
    </>
  );
  if (href) {
    return <Link to={href} style={{ ...st.tile, ...st.tileLink }}>{content}</Link>;
  }
  return <div style={st.tile}>{content}</div>;
}

// ─── helpers ──────────────────────────────────────────────────────────
export function fmt(n) {
  if (n == null) return "—";
  return `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

const st = {
  page: {
    minHeight: "calc(100vh - 60px)",
    background: gradients.pageDark,
    marginLeft: "-1rem", marginRight: "-1rem",
    maxWidth: "calc(100% + 2rem)", boxSizing: "border-box",
    marginTop: "-2rem", marginBottom: "-2rem",
    padding: "0 0 5rem",
    color: colors.textPrimary,
  },
  // Sub-nav with violet accent — clearly admin scope.
  subnav: {
    background: "rgba(15,23,42,0.7)",
    borderBottom: `1px solid ${adminColors.border}`,
    position: "sticky", top: 0, zIndex: 50,
    backdropFilter: "blur(6px)",
  },
  subnavInner: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    height: 52,
  },
  sublink: {
    color: colors.textMuted, textDecoration: "none",
    fontSize: "0.85rem", fontWeight: 600,
    padding: "0.45rem 0.9rem", borderRadius: 6,
    letterSpacing: "0.02em",
  },
  sublinkActive: {
    color: adminColors.accentLight,
    background: "rgba(167,139,250,0.1)",
  },

  header: { padding: "3rem 0 2rem" },
  eyebrow: {
    color: adminColors.accent, fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
  },
  eyebrowMark: { marginRight: "0.4rem" },
  title: {
    fontSize: "clamp(1.8rem, 3vw, 2.4rem)", fontWeight: 800,
    margin: "0.65rem 0 0.5rem", letterSpacing: "-0.02em",
    color: colors.textPrimary,
  },
  sub: { color: colors.textMuted, fontSize: "0.92rem" },

  errorBanner: {
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.3)",
    color: "#fca5a5",
    padding: "0.75rem 1rem", borderRadius: 8,
    fontSize: "0.85rem", marginBottom: "1.5rem",
  },

  // ── Stat tiles ──
  tileRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "1rem", marginBottom: "2.5rem",
  },
  tile: {
    background: gradients.violetPanel,
    border: `1px solid ${adminColors.border}`,
    borderRadius: 14,
    padding: "1.25rem 1.4rem",
    display: "flex", flexDirection: "column", gap: "0.65rem",
  },
  tileLink: {
    color: "inherit", textDecoration: "none",
    transition: "border-color 0.15s, transform 0.15s",
  },
  tileLabel: {
    color: colors.textMuted,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
  },
  tileValue: {
    fontSize: "1.85rem", fontWeight: 800,
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
  },
  tileValueAccent: { color: adminColors.accentLight },

  // ── Table ──
  tableSection: { marginBottom: "3rem" },
  sectionHead: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    marginBottom: "1rem",
  },
  sectionTitle: {
    fontSize: "1.05rem", fontWeight: 700, margin: 0,
    color: colors.textPrimary, letterSpacing: "-0.01em",
  },
  sectionCount: {
    fontSize: "0.7rem", fontWeight: 700,
    color: colors.textFaint,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  tableScroll: {
    overflowX: "auto",
    background: "rgba(15,23,42,0.4)",
    border: `1px solid ${adminColors.border}`,
    borderRadius: 12,
  },
  table: {
    width: "100%", minWidth: 920,
    borderCollapse: "collapse",
    fontSize: "0.84rem",
  },
  th: {
    textAlign: "left",
    padding: "0.7rem 0.9rem",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: colors.textFaint,
    borderBottom: `1px solid ${adminColors.border}`,
    background: "rgba(15,23,42,0.6)",
    position: "sticky", top: 0,
  },
  thRight: { textAlign: "right" },
  row: { borderBottom: "1px solid rgba(255,255,255,0.04)" },
  td: { padding: "0.7rem 0.9rem", color: colors.textSecondary },
  tdRight: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tdMono: {
    padding: "0.7rem 0.9rem",
    color: colors.textMuted,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.8rem",
  },
  tdStrong: {
    padding: "0.7rem 0.9rem",
    color: colors.textPrimary, fontWeight: 600,
  },
  tdValue: {
    color: adminColors.accentLight, fontWeight: 700,
  },
  tdEmpty: {
    padding: "2rem 1rem", textAlign: "center",
    color: colors.textFaint, fontSize: "0.85rem",
  },
};
