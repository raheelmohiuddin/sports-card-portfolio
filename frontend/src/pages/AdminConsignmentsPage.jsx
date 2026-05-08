import { useEffect, useState } from "react";
import { getAdminConsignments, updateAdminConsignment } from "../services/api.js";
import { colors, adminColors, gradients } from "../utils/theme.js";
import { AdminTopNav, fmt, fmtDate } from "./AdminPage.jsx";

const STATUSES = [
  { value: "pending",   label: "Pending"   },
  { value: "in_review", label: "In Review" },
  { value: "listed",    label: "Listed"    },
  { value: "sold",      label: "Sold"      },
  { value: "declined",  label: "Declined"  },
];
const TYPE_LABEL = { auction: "Auction", private: "Private Sale" };

export default function AdminConsignmentsPage() {
  const [rows, setRows]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAdminConsignments()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load consignments"); });
    return () => { cancelled = true; };
  }, []);

  // Local optimistic patch so the row's status / notes update immediately
  // while the PATCH is in flight. On error we revert and surface a banner.
  function patchRow(id, patch) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    updateAdminConsignment(id, patch).catch((e) => {
      setError(e?.message ?? "Update failed");
      // Refetch on error to re-sync.
      getAdminConsignments().then(setRows).catch(() => {});
    });
  }

  return (
    <div style={st.page}>
      <AdminTopNav />
      <div className="container">
        <header style={st.header}>
          <p style={st.eyebrow}><span>◆</span> Collector's Reserve · Admin</p>
          <h1 style={st.title}>Consignment Requests</h1>
          <p style={st.sub}>Review, triage, and track every consignment open on the platform.</p>
        </header>

        {error && <div style={st.errorBanner}>{error}</div>}

        <div style={st.tableScroll}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Submitted</th>
                <th style={st.th}>First</th>
                <th style={st.th}>Last</th>
                <th style={st.th}>Card</th>
                <th style={{ ...st.th, ...st.thRight }}>Grade</th>
                <th style={{ ...st.th, ...st.thRight }}>Estimated</th>
                <th style={{ ...st.th, ...st.thRight }}>Asking</th>
                <th style={st.th}>Type</th>
                <th style={st.th}>Status</th>
                <th style={st.th}>Internal Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows?.length === 0 && (
                <tr><td colSpan={10} style={st.tdEmpty}>No consignment requests yet.</td></tr>
              )}
              {rows?.map((r) => (
                <ConsignmentRow key={r.id} row={r} onPatch={patchRow} />
              ))}
              {!rows && !error && (
                <tr><td colSpan={10} style={st.tdEmpty}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ConsignmentRow({ row, onPatch }) {
  const [notes, setNotes] = useState(row.internalNotes ?? "");
  const cardLabel = [row.card.year, row.card.brand, row.card.playerName].filter(Boolean).join(" ") || "—";

  function commitNotes() {
    if ((notes ?? "") === (row.internalNotes ?? "")) return;
    onPatch(row.id, { internalNotes: notes });
  }

  return (
    <tr style={st.row}>
      <td style={st.td}>{fmtDate(row.createdAt)}</td>
      <td style={st.td}>{row.user.givenName  ?? "—"}</td>
      <td style={st.td}>{row.user.familyName ?? "—"}</td>
      <td style={st.tdStrong}>
        {cardLabel}
        {row.card.certNumber && <span style={st.cert}> · {row.card.certNumber}</span>}
        {row.notes && <div style={st.subnote}>{row.notes}</div>}
      </td>
      <td style={{ ...st.td, ...st.tdRight }}>{row.card.grade ?? "—"}</td>
      <td style={{ ...st.td, ...st.tdRight }}>{fmt(row.card.estimatedValue)}</td>
      <td style={{ ...st.td, ...st.tdRight, ...st.tdValue }}>{fmt(row.askingPrice)}</td>
      <td style={st.td}>{TYPE_LABEL[row.type] ?? row.type}</td>
      <td style={st.td}>
        <select
          value={row.status}
          onChange={(e) => onPatch(row.id, { status: e.target.value })}
          style={{ ...st.select, ...statusStyle(row.status) }}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value} style={{ color: "#0f172a" }}>{s.label}</option>
          ))}
        </select>
      </td>
      <td style={st.td}>
        <textarea
          rows={2}
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          placeholder="Add internal note…"
          style={st.notes}
        />
      </td>
    </tr>
  );
}

function statusStyle(s) {
  switch (s) {
    case "pending":   return { background: "rgba(245,158,11,0.12)",  color: "#fbbf24", borderColor: "rgba(245,158,11,0.4)"  };
    case "in_review": return { background: "rgba(167,139,250,0.12)", color: "#c4b5fd", borderColor: "rgba(167,139,250,0.4)" };
    case "listed":    return { background: "rgba(96,165,250,0.12)",  color: "#93c5fd", borderColor: "rgba(96,165,250,0.4)"  };
    case "sold":      return { background: "rgba(16,185,129,0.12)",  color: "#6ee7b7", borderColor: "rgba(16,185,129,0.4)"  };
    case "declined":  return { background: "rgba(248,113,113,0.12)", color: "#fca5a5", borderColor: "rgba(248,113,113,0.4)" };
    default:          return {};
  }
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
  header: { padding: "3rem 0 2rem" },
  eyebrow: {
    color: adminColors.accent, fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
  },
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

  tableScroll: {
    overflowX: "auto",
    background: "rgba(15,23,42,0.4)",
    border: `1px solid ${adminColors.border}`,
    borderRadius: 12,
  },
  table: {
    width: "100%", minWidth: 1100,
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
  },
  thRight: { textAlign: "right" },
  row: { borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "top" },
  td: { padding: "0.7rem 0.9rem", color: colors.textSecondary },
  tdRight: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tdStrong: {
    padding: "0.7rem 0.9rem",
    color: colors.textPrimary, fontWeight: 600,
    minWidth: 220,
  },
  tdValue: { color: adminColors.accentLight, fontWeight: 700 },
  tdEmpty: {
    padding: "2rem 1rem", textAlign: "center",
    color: colors.textFaint, fontSize: "0.85rem",
  },
  cert: {
    color: colors.textFaint, fontWeight: 500,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.78rem",
  },
  subnote: {
    color: colors.textMuted, fontWeight: 400,
    fontSize: "0.78rem", marginTop: "0.3rem",
    fontStyle: "italic",
  },

  select: {
    fontSize: "0.78rem", fontWeight: 700,
    padding: "0.3rem 0.6rem",
    borderRadius: 6,
    border: "1px solid",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.04em", textTransform: "uppercase",
  },
  notes: {
    width: 220,
    fontFamily: "inherit", fontSize: "0.78rem",
    background: "rgba(15,23,42,0.7)",
    color: colors.textSecondary,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    padding: "0.4rem 0.5rem",
    resize: "vertical",
  },
};
