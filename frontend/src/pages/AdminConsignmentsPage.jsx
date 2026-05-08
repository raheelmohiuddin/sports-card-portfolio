import { useEffect, useMemo, useState } from "react";
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
const STATUS_RANK = { pending: 0, in_review: 1, listed: 2, sold: 3, declined: 4 };
const TYPE_LABEL = { auction: "Auction", private: "Private Sale" };

// Each sortable column declares a comparator on the row. Default sort is
// by status rank (pending first), with newest-first as a tiebreaker.
const COLUMNS = [
  { key: "createdAt",  label: "Submitted",     align: "left",  get: (r) => new Date(r.createdAt).getTime() },
  { key: "firstName",  label: "First",         align: "left",  get: (r) => (r.user.givenName  ?? "").toLowerCase() },
  { key: "lastName",   label: "Last",          align: "left",  get: (r) => (r.user.familyName ?? "").toLowerCase() },
  { key: "card",       label: "Card",          align: "left",  get: (r) => (`${r.card.year ?? ""} ${r.card.brand ?? ""} ${r.card.playerName ?? ""}`).trim().toLowerCase() },
  { key: "grade",      label: "Grade",         align: "right", get: (r) => parseFloat(r.card.grade) || 0 },
  { key: "estimated",  label: "Estimated",     align: "right", get: (r) => r.card.estimatedValue ?? 0 },
  { key: "asking",     label: "Asking",        align: "right", get: (r) => r.askingPrice ?? 0 },
  { key: "soldPrice",  label: "Sold Price",    align: "right", get: (r) => r.soldPrice   ?? 0 },
  { key: "type",       label: "Type",          align: "left",  get: (r) => r.type },
  { key: "status",     label: "Status",        align: "left",  get: (r) => STATUS_RANK[r.status] ?? 99 },
  { key: "notes",      label: "Internal Notes",align: "left",  get: (r) => (r.internalNotes ?? "").toLowerCase(), unsortable: true },
];

export default function AdminConsignmentsPage() {
  const [rows, setRows]         = useState(null);
  const [error, setError]       = useState(null);
  // Sort state: which column key + direction. Default is status (pending
  // first), with no explicit direction so the comparator runs natural.
  const [sortKey, setSortKey]   = useState("status");
  const [sortDir, setSortDir]   = useState("asc");
  // Filter state.
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter,   setTypeFilter]   = useState("all");

  useEffect(() => {
    let cancelled = false;
    getAdminConsignments()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load consignments"); });
    return () => { cancelled = true; };
  }, []);

  function patchRow(id, patch) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    updateAdminConsignment(id, patch).catch((e) => {
      setError(e?.message ?? "Update failed");
      getAdminConsignments().then(setRows).catch(() => {});
    });
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Visible rows: filter then sort. Status comparator includes a createdAt
  // tiebreaker so equal-status rows show newest-first by default.
  const visible = useMemo(() => {
    if (!rows) return null;
    const col = COLUMNS.find((c) => c.key === sortKey);
    const filtered = rows.filter((r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (typeFilter   === "all" || r.type   === typeFilter)
    );
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      // Tiebreaker: newest-first for non-time keys.
      if (col.key !== "createdAt") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return 0;
    });
  }, [rows, sortKey, sortDir, statusFilter, typeFilter]);

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

        {/* ── Filters ── */}
        <div style={st.filterBar}>
          <FilterDropdown
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "All statuses" }, ...STATUSES]}
          />
          <FilterDropdown
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all",     label: "All types"     },
              { value: "auction", label: "Auction"       },
              { value: "private", label: "Private Sale"  },
            ]}
          />
          <span style={st.filterCount}>
            {visible?.length ?? 0} of {rows?.length ?? 0}
          </span>
        </div>

        <div style={st.tableScroll}>
          <table style={st.table}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    style={{ ...st.th, textAlign: c.align, ...(c.unsortable ? {} : st.thSortable) }}
                    onClick={c.unsortable ? undefined : () => toggleSort(c.key)}
                  >
                    {c.label}
                    {!c.unsortable && (
                      <span style={st.sortMark}>
                        {sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible?.length === 0 && (
                <tr><td colSpan={COLUMNS.length} style={st.tdEmpty}>
                  {rows?.length === 0 ? "No consignment requests yet." : "No rows match the current filters."}
                </td></tr>
              )}
              {visible?.map((r) => (
                <ConsignmentRow key={r.id} row={r} onPatch={patchRow} />
              ))}
              {!rows && !error && (
                <tr><td colSpan={COLUMNS.length} style={st.tdEmpty}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterDropdown({ label, value, onChange, options }) {
  return (
    <label style={st.filterLabel}>
      <span style={st.filterLabelText}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={st.filterSelect}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ color: "#0f172a" }}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function ConsignmentRow({ row, onPatch }) {
  const [notes, setNotes]         = useState(row.internalNotes ?? "");
  const [soldInput, setSoldInput] = useState(row.soldPrice != null ? String(row.soldPrice) : "");
  const cardLabel = [row.card.year, row.card.brand, row.card.playerName].filter(Boolean).join(" ") || "—";

  // Resync local input when the row prop changes (e.g. refetch after error).
  useEffect(() => {
    setNotes(row.internalNotes ?? "");
    setSoldInput(row.soldPrice != null ? String(row.soldPrice) : "");
  }, [row.id, row.internalNotes, row.soldPrice]);

  function commitNotes() {
    if ((notes ?? "") === (row.internalNotes ?? "")) return;
    onPatch(row.id, { internalNotes: notes });
  }
  function commitSoldPrice() {
    const trimmed = soldInput.trim();
    const next = trimmed === "" ? null : parseFloat(trimmed);
    if (next != null && (Number.isNaN(next) || next < 0)) return;
    if (next === (row.soldPrice ?? null)) return;
    onPatch(row.id, { soldPrice: next });
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
      {/* Sold Price — editable only when status is "sold". Other statuses
          show "—" so the column lines up but isn't actionable. */}
      <td style={{ ...st.td, ...st.tdRight }}>
        {row.status === "sold" ? (
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={soldInput}
            onChange={(e) => setSoldInput(e.target.value)}
            onBlur={commitSoldPrice}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            placeholder="—"
            style={st.soldInput}
          />
        ) : (
          <span style={st.tdMuted}>—</span>
        )}
      </td>
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
    case "in_review": return { background: "rgba(96,165,250,0.12)",  color: "#93c5fd", borderColor: "rgba(96,165,250,0.4)"  };
    case "listed":    return { background: "rgba(16,185,129,0.12)",  color: "#6ee7b7", borderColor: "rgba(16,185,129,0.4)"  };
    case "sold":      return { background: "rgba(16,185,129,0.18)",  color: "#a7f3d0", borderColor: "rgba(16,185,129,0.55)" };
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

  // ── Filters ──
  filterBar: {
    display: "flex", gap: "1rem", alignItems: "center",
    flexWrap: "wrap",
    marginBottom: "1rem",
  },
  filterLabel: {
    display: "flex", alignItems: "center", gap: "0.5rem",
  },
  filterLabelText: {
    color: colors.textFaint,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  filterSelect: {
    background: "rgba(15,23,42,0.7)",
    color: colors.textSecondary,
    border: `1px solid ${adminColors.border}`,
    borderRadius: 6,
    padding: "0.35rem 0.65rem",
    fontSize: "0.8rem", fontFamily: "inherit",
    cursor: "pointer",
  },
  filterCount: {
    marginLeft: "auto",
    color: colors.textFaint,
    fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.14em", textTransform: "uppercase",
    fontVariantNumeric: "tabular-nums",
  },

  tableScroll: {
    overflowX: "auto",
    background: "rgba(15,23,42,0.4)",
    border: `1px solid ${adminColors.border}`,
    borderRadius: 12,
  },
  table: {
    width: "100%", minWidth: 1200,
    borderCollapse: "collapse",
    fontSize: "0.84rem",
  },
  th: {
    padding: "0.7rem 0.9rem",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: colors.textFaint,
    borderBottom: `1px solid ${adminColors.border}`,
    background: "rgba(15,23,42,0.6)",
    userSelect: "none",
  },
  thSortable: {
    cursor: "pointer",
  },
  sortMark: {
    display: "inline-block",
    marginLeft: "0.35rem",
    color: adminColors.accentLight,
    minWidth: "0.7em",
  },
  row: { borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "top" },
  td: { padding: "0.7rem 0.9rem", color: colors.textSecondary },
  tdRight: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tdMuted: { color: colors.textVeryFaint },
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
  soldInput: {
    width: 100,
    background: "rgba(245,158,11,0.06)",
    color: "#fbbf24",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 6,
    padding: "0.3rem 0.5rem",
    fontSize: "0.84rem", fontWeight: 700,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
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
