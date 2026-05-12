import { useEffect, useMemo, useState } from "react";
import {
  getAdminConsignments, updateAdminConsignment,
  getAdminCard, getAdminCardSales,
} from "../services/api.js";
import { colors, adminColors, gradients } from "../utils/theme.js";
import { AdminTopNav, fmt, fmtDate } from "./AdminPage.jsx";
import CardModal from "../components/CardModal.jsx";

// CardModal accepts a `loaders` object so it can be driven by the
// admin-scoped endpoints (not gated on user_id ownership) when an admin
// opens it from the consignments queue. Defined once at module scope so
// the reference is stable and CardModal's effects don't churn.
const ADMIN_LOADERS = { getCard: getAdminCard, getCardSales: getAdminCardSales };

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
  { key: "createdAt",  label: "Submitted",      get: (r) => new Date(r.createdAt).getTime() },
  { key: "firstName",  label: "First",          get: (r) => (r.user.givenName  ?? "").toLowerCase() },
  { key: "lastName",   label: "Last",           get: (r) => (r.user.familyName ?? "").toLowerCase() },
  { key: "card",       label: "Card",           get: (r) => (`${r.card.year ?? ""} ${r.card.brand ?? ""} ${r.card.playerName ?? ""}`).trim().toLowerCase() },
  { key: "grade",      label: "Grade",          get: (r) => parseFloat(r.card.grade) || 0 },
  { key: "estimated",  label: "Estimated",      get: (r) => r.card.estimatedValue ?? 0 },
  { key: "asking",     label: "Asking",         get: (r) => r.askingPrice ?? 0 },
  { key: "soldPrice",  label: "Sold Price",     get: (r) => r.soldPrice   ?? 0 },
  { key: "feePct",     label: "Consignment Fee %", get: (r) => r.consignmentFeePct ?? 0 },
  { key: "sellersNet", label: "Seller's Net",      get: (r) => r.sellersNet ?? 0 },
  { key: "type",       label: "Type",           get: (r) => r.type },
  { key: "status",     label: "Status",         get: (r) => STATUS_RANK[r.status] ?? 99 },
  { key: "notes",      label: "Internal Notes", get: (r) => (r.internalNotes ?? "").toLowerCase(), unsortable: true },
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
  // Currently-open consignment (drives the CardModal sidebar). The card's
  // full detail comes from getAdminCard inside CardModal; we just hold the
  // consignment row here so the admin section in the modal stays in sync
  // with whatever's in the queue list.
  const [openConsignment, setOpenConsignment] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAdminConsignments()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load consignments"); });
    return () => { cancelled = true; };
  }, []);

  // Returns the underlying request promise so the editable cells in the
  // row can chain on it (flash a success indicator on resolve, stay in
  // edit mode on error). Optimistic state update happens immediately;
  // failure path refetches to re-sync.
  function patchRow(id, patch) {
    // Optimistic local merge for the keys the admin sent. The server
    // response is then merged on top — important because sellers_net is
    // computed server-side from sold_price + consignment_fee_pct, so the
    // client never authors that field and needs the round-trip to see it.
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    return updateAdminConsignment(id, patch)
      .then((response) => {
        setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...response } : r));
        return response;
      })
      .catch((e) => {
        setError(e?.message ?? "Update failed");
        getAdminConsignments().then(setRows).catch(() => {});
        throw e;
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
              <tr style={st.theadRow}>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    style={{ ...st.th, ...(c.unsortable ? {} : st.thSortable) }}
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
                <ConsignmentRow
                  key={r.id}
                  row={r}
                  onPatch={patchRow}
                  onOpen={() => setOpenConsignment(r)}
                />
              ))}
              {!rows && !error && (
                <tr><td colSpan={COLUMNS.length} style={st.tdEmpty}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CardModal opens on row click. We seed `card` with the slim subset
          the consignments query already returned (player / year / brand /
          grade / cert / estimated value) so the modal's initial render
          isn't blank — then loaders.getCard(id) resolves at +340ms with
          the full payload (image URL, PSA pop, etc.) and the modal updates.
          The consignment row drives the read-only Consignment block in the
          sidebar (admin-side only — the collector ConsignBlock is
          suppressed when adminConsignment is set). */}
      {openConsignment && (
        <CardModal
          card={openConsignment.card}
          loaders={ADMIN_LOADERS}
          adminConsignment={openConsignment}
          onClose={() => setOpenConsignment(null)}
        />
      )}
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

function ConsignmentRow({ row, onPatch, onOpen }) {
  const [notes, setNotes]     = useState(row.internalNotes ?? "");
  const [hovered, setHovered] = useState(false);
  // Track whether any cell in this row is in edit/saving mode. Pinned
  // editing keeps the pencil icons visible on every cell of this row
  // even when the cursor leaves — otherwise hover-only would hide the
  // active cell's controls mid-edit.
  const [statusEditing, setStatusEditing] = useState(false);
  const [priceEditing,  setPriceEditing]  = useState(false);
  const [feePctEditing, setFeePctEditing] = useState(false);
  const isEditing = statusEditing || priceEditing || feePctEditing;
  const cardLabel = [row.card.year, row.card.brand, row.card.playerName].filter(Boolean).join(" ") || "—";

  useEffect(() => { setNotes(row.internalNotes ?? ""); }, [row.id, row.internalNotes]);

  function commitNotes() {
    if ((notes ?? "") === (row.internalNotes ?? "")) return;
    onPatch(row.id, { internalNotes: notes });
  }

  // Open the CardModal sidebar on row click — but only when the click
  // hasn't landed on (or inside) a form control. The editable status /
  // sold-price cells contain real <button>/<select>/<input> nodes; the
  // notes textarea and the column-sort buttons in the header are also
  // interactive. closest() catches all of them in one check.
  //
  // try/catch so a thrown error here can't unmount the page silently;
  // the log lets us see the exact card payload going into CardModal
  // when something goes wrong opening the sidebar.
  function handleRowClick(e) {
    try {
      if (isEditing) return;
      if (e.target.closest("button, select, input, textarea")) return;
      console.log("admin row click — card payload:", row.card, "consignment:", row);
      onOpen?.();
    } catch (err) {
      console.error("admin row click handler threw:", err);
    }
  }

  return (
    <tr
      className={`scp-admin-row${isEditing ? " is-editing" : ""}`}
      style={{ ...st.row, ...(hovered && !isEditing ? st.rowHover : {}) }}
      onClick={handleRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td style={st.td}>{fmtDate(row.createdAt)}</td>
      <td style={st.td}>{row.user.givenName  ?? "—"}</td>
      <td style={st.td}>{row.user.familyName ?? "—"}</td>
      <td style={st.tdCard}>
        <div>{cardLabel}</div>
        {row.card.certNumber && <div style={st.cert}>{row.card.certNumber}</div>}
        {row.notes && <div style={st.subnote}>{row.notes}</div>}
      </td>
      <td style={st.td}>{row.card.grade ?? "—"}</td>
      <td style={st.td}>{fmt(row.card.estimatedValue)}</td>
      <td style={{ ...st.td, ...st.tdValue }}>{fmt(row.askingPrice)}</td>
      <td style={st.td}>
        <EditableSoldPrice
          value={row.soldPrice}
          enabled={row.status === "sold"}
          onSave={(next) => onPatch(row.id, { soldPrice: next })}
          setEditing={setPriceEditing}
        />
      </td>
      <td style={st.td}>
        <EditableFeePct
          value={row.consignmentFeePct}
          enabled={row.status === "sold"}
          onSave={(next) => onPatch(row.id, { consignmentFeePct: next })}
          setEditing={setFeePctEditing}
        />
      </td>
      <td style={st.td}>
        {row.sellersNet != null ? (
          <span style={st.sellersNetText}>{fmt(row.sellersNet)}</span>
        ) : <span style={st.tdMuted}>—</span>}
      </td>
      <td style={st.td}>{TYPE_LABEL[row.type] ?? row.type}</td>
      <td style={st.td}>
        <EditableStatus
          value={row.status}
          onSave={(next) => onPatch(row.id, { status: next })}
          setEditing={setStatusEditing}
        />
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

// ─── Editable status (text → select + ✓/✗) ───────────────────────────
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));

// Color the value text per status — same hue family as the previous chip,
// just without the box. Keeps the visual signal at a glance.
function statusTextColor(s) {
  switch (s) {
    case "pending":   return "#e6c463";
    case "in_review": return "#93c5fd";
    case "listed":    return "#6ee7b7";
    case "sold":      return "#a7f3d0";
    case "declined":  return "#fca5a5";
    default:          return "#cbd5e1";
  }
}

function EditableStatus({ value, onSave, setEditing }) {
  const [mode, setMode]   = useState("display"); // display | edit | saving | success
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (mode === "display") setDraft(value);
  }, [value, mode]);

  // Bubble edit-mode up to the row so we can keep the icon visible until
  // the admin commits or cancels (otherwise hover-only would hide it
  // mid-edit if the cursor moves elsewhere).
  useEffect(() => {
    setEditing?.(mode === "edit" || mode === "saving");
  }, [mode, setEditing]);

  // Auto-clear the success flash.
  useEffect(() => {
    if (mode !== "success") return;
    const t = setTimeout(() => setMode("display"), 1200);
    return () => clearTimeout(t);
  }, [mode]);

  if (mode === "display" || mode === "success") {
    return (
      <span style={st.cellInline}>
        <span style={{ ...st.cellText, color: statusTextColor(value) }}>
          {STATUS_LABEL[value] ?? value}
        </span>
        {mode === "success"
          ? <span style={st.successFlash} aria-label="Saved">✓</span>
          : <EditIcon onClick={() => setMode("edit")} ariaLabel="Edit status" />}
      </span>
    );
  }

  const busy = mode === "saving";
  async function confirm() {
    if (draft === value) { setMode("display"); return; }
    setMode("saving");
    try { await onSave(draft); setMode("success"); }
    catch { setMode("edit"); }
  }
  function cancel() { setDraft(value); setMode("display"); }

  return (
    <span style={st.cellInline}>
      <select
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
        style={{ ...st.bareSelect, color: statusTextColor(draft) }}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value} style={{ color: "#0f172a" }}>{s.label}</option>
        ))}
      </select>
      <ConfirmCancel busy={busy} onConfirm={confirm} onCancel={cancel} />
    </span>
  );
}

// ─── Editable sold price (text → input + ✓/✗) ────────────────────────
function EditableSoldPrice({ value, enabled, onSave, setEditing }) {
  const [mode, setMode]   = useState("display");
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    if (mode === "display") setDraft(value != null ? String(value) : "");
  }, [value, mode]);

  useEffect(() => {
    setEditing?.(mode === "edit" || mode === "saving");
  }, [mode, setEditing]);

  useEffect(() => {
    if (mode !== "success") return;
    const t = setTimeout(() => setMode("display"), 1200);
    return () => clearTimeout(t);
  }, [mode]);

  if (!enabled) return <span style={st.tdMuted}>—</span>;

  if (mode === "display" || mode === "success") {
    return (
      <span style={st.cellInline}>
        <span style={value != null ? st.priceText : st.priceTextEmpty}>
          {value != null ? fmt(value) : "—"}
        </span>
        {mode === "success"
          ? <span style={st.successFlash} aria-label="Saved">✓</span>
          : <EditIcon onClick={() => setMode("edit")} ariaLabel="Edit sold price" />}
      </span>
    );
  }

  const busy = mode === "saving";
  async function confirm() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : parseFloat(trimmed);
    if (next != null && (Number.isNaN(next) || next < 0)) return;
    if (next === (value ?? null)) { setMode("display"); return; }
    setMode("saving");
    try { await onSave(next); setMode("success"); }
    catch { setMode("edit"); }
  }
  function cancel() {
    setDraft(value != null ? String(value) : "");
    setMode("display");
  }

  return (
    <span style={st.cellInline}>
      <span style={st.priceInputDollar}>$</span>
      <input
        autoFocus
        type="number" min="0" step="0.01" inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter")  confirm();
          if (e.key === "Escape") cancel();
        }}
        disabled={busy}
        placeholder="0.00"
        style={st.bareInput}
      />
      <ConfirmCancel busy={busy} onConfirm={confirm} onCancel={cancel} />
    </span>
  );
}

// ─── Editable consignment fee % (text → input + ✓/✗) ─────────────────
// Same pattern as EditableSoldPrice but bounded 0–100 with a "%" suffix
// instead of a "$" prefix. Triggers a server-side sellers_net recompute
// on save (admin patchRow merges the server response).
function EditableFeePct({ value, enabled, onSave, setEditing }) {
  const [mode, setMode]   = useState("display");
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    if (mode === "display") setDraft(value != null ? String(value) : "");
  }, [value, mode]);

  useEffect(() => {
    setEditing?.(mode === "edit" || mode === "saving");
  }, [mode, setEditing]);

  useEffect(() => {
    if (mode !== "success") return;
    const t = setTimeout(() => setMode("display"), 1200);
    return () => clearTimeout(t);
  }, [mode]);

  if (!enabled) return <span style={st.tdMuted}>—</span>;

  if (mode === "display" || mode === "success") {
    return (
      <span style={st.cellInline}>
        <span style={value != null ? st.priceText : st.priceTextEmpty}>
          {value != null ? `${parseFloat(value).toFixed(2)}%` : "—"}
        </span>
        {mode === "success"
          ? <span style={st.successFlash} aria-label="Saved">✓</span>
          : <EditIcon onClick={() => setMode("edit")} ariaLabel="Edit consignment fee" />}
      </span>
    );
  }

  const busy = mode === "saving";
  async function confirm() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : parseFloat(trimmed);
    if (next != null && (Number.isNaN(next) || next < 0 || next > 100)) return;
    if (next === (value ?? null)) { setMode("display"); return; }
    setMode("saving");
    try { await onSave(next); setMode("success"); }
    catch { setMode("edit"); }
  }
  function cancel() {
    setDraft(value != null ? String(value) : "");
    setMode("display");
  }

  return (
    <span style={st.cellInline}>
      <input
        autoFocus
        type="number" min="0" max="100" step="0.01" inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter")  confirm();
          if (e.key === "Escape") cancel();
        }}
        disabled={busy}
        placeholder="0"
        style={st.bareInput}
      />
      <span style={st.priceInputDollar}>%</span>
      <ConfirmCancel busy={busy} onConfirm={confirm} onCancel={cancel} />
    </span>
  );
}

// Small gold pencil — the only edit-mode trigger. Hover-only visibility
// is owned by the .scp-edit-icon CSS class (rule lives in index.css).
function EditIcon({ onClick, ariaLabel }) {
  return (
    <button
      type="button"
      className="scp-edit-icon"
      onClick={onClick}
      style={st.editIcon}
      aria-label={ariaLabel}
      title={ariaLabel}
    >✎</button>
  );
}

// ─── Shared confirm / cancel button pair ──────────────────────────────
function ConfirmCancel({ busy, onConfirm, onCancel }) {
  return (
    <>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        style={{ ...st.iconBtn, ...st.iconBtnConfirm, ...(busy ? st.iconBtnBusy : {}) }}
        aria-label="Save"
        title="Save"
      >
        {busy ? "…" : "✓"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{ ...st.iconBtn, ...st.iconBtnCancel, ...(busy ? st.iconBtnBusy : {}) }}
        aria-label="Cancel"
        title="Cancel"
      >
        ✕
      </button>
    </>
  );
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
  // Explicit `display: table` on the wrapper + table-row / table-cell on
  // the descendants below — most browsers compute these implicitly for
  // <table>/<tr>/<th>, but anything that injects a flex/grid context
  // higher up (or a global selector touching `table`) can knock the
  // header out of the table-layout algorithm and break vertical-align.
  // Spelling them out makes the layout robust against that.
  table: {
    display: "table",
    width: "100%", minWidth: 1200,
    borderCollapse: "collapse",
    fontSize: "0.84rem",
    tableLayout: "auto",
  },
  // Header row — fixed 48px height, declared explicitly on the <tr> so
  // every <th> inherits the same row box regardless of its own content.
  theadRow: {
    display: "table-row",
    height: 48,
  },
  // Each cell renders as a true table-cell so vertical-align: middle
  // actually applies (vertical-align is a no-op on flex/inline-block
  // containers, which is the most common reason "centered" header text
  // ends up at the top).
  th: {
    display: "table-cell",
    height: 48,
    padding: "0 0.75rem",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: colors.textFaint,
    borderBottom: `1px solid ${adminColors.border}`,
    background: "rgba(15,23,42,0.6)",
    textAlign: "center",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    userSelect: "none",
    boxSizing: "border-box",
  },
  thSortable: { cursor: "pointer" },
  sortMark: {
    display: "inline-block",
    marginLeft: "0.35rem",
    color: adminColors.accentLight,
    minWidth: "0.7em",
  },
  // Consistent row height + a single hairline divider — no per-cell
  // borders, no zebra striping, no padding noise. Cells pick up the
  // shared height/alignment from .row → td chain. Cursor: pointer hints
  // that the row opens a sidebar on click; rowHover layers a subtle
  // violet wash over the row to confirm the click target.
  row: {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    cursor: "pointer",
    transition: "background 0.12s ease",
  },
  rowHover: {
    background: "rgba(167,139,250,0.05)",
  },
  td: {
    height: 56,
    padding: "0 0.75rem",
    color: colors.textSecondary,
    textAlign: "center",
    verticalAlign: "middle",
    fontVariantNumeric: "tabular-nums",
  },
  tdMuted: { color: colors.textVeryFaint },
  // The Card column carries multi-line content (label + cert + maybe
  // collector note), so it gets a slightly different rhythm — still
  // center-aligned but with stacked lines.
  tdCard: {
    height: 56,
    padding: "0.5rem 0.75rem",
    color: colors.textPrimary,
    fontWeight: 600,
    textAlign: "center",
    verticalAlign: "middle",
    minWidth: 200,
  },
  tdValue: { color: adminColors.accentLight, fontWeight: 700 },
  tdEmpty: {
    padding: "2rem 1rem", textAlign: "center",
    color: colors.textFaint, fontSize: "0.85rem",
  },
  cert: {
    color: colors.textFaint, fontWeight: 500,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.74rem",
    marginTop: "0.15rem",
  },
  subnote: {
    color: colors.textMuted, fontWeight: 400,
    fontSize: "0.74rem", marginTop: "0.2rem",
    fontStyle: "italic",
  },

  // ── Editable cells: borderless display + borderless edit ──
  // Inline wrapper that places the value text + the (hover-only) pencil
  // icon, or the input/select + ✓/✗ buttons, on a single centered line.
  cellInline: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.4rem",
  },
  cellText: {
    fontWeight: 700,
    letterSpacing: "0.04em", textTransform: "uppercase",
    fontSize: "0.78rem",
  },
  priceText: {
    color: "#e6c463",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.86rem",
  },
  priceTextEmpty: {
    color: colors.textVeryFaint,
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.86rem",
  },
  // Read-only Seller's Net cell — green so it visually pairs with the
  // pill colour for the "sold" status and reads as "money the collector
  // actually receives." Server-computed; admin can't edit directly.
  sellersNetText: {
    color: "#6ee7b7",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.86rem",
  },
  // Native select stripped of all chrome — same color/size as the
  // display text so the cell's visual weight doesn't shift on click.
  bareSelect: {
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    background: "transparent",
    border: "none",
    outline: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 700,
    fontSize: "0.78rem",
    letterSpacing: "0.04em", textTransform: "uppercase",
    padding: 0,
    textAlign: "center",
    textAlignLast: "center", // selected option centering for some browsers
  },
  // $ glyph that visually leads the price input.
  priceInputDollar: {
    color: "#e6c463",
    fontSize: "0.86rem",
    fontWeight: 700,
    marginRight: "-0.1rem",
  },
  bareInput: {
    width: 90,
    background: "transparent",
    color: "#e6c463",
    border: "none",
    outline: "none",
    padding: 0,
    fontSize: "0.86rem", fontWeight: 700,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    textAlign: "center",
  },

  // The hover-only pencil. Inline style sets size + color; the .scp-edit-icon
  // class (in index.css) handles opacity transitions on row hover.
  editIcon: {
    width: 22, height: 22,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent",
    border: "none",
    color: "#d4af37",
    cursor: "pointer",
    fontSize: "0.78rem",
    padding: 0,
    fontFamily: "inherit",
  },
  // Brief success flash — green check that replaces the pencil after save.
  successFlash: {
    color: "#10b981",
    fontWeight: 900,
    fontSize: "0.85rem",
    width: 22, height: 22,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  },

  // ── Confirm (✓) / Cancel (✕) icon buttons ──
  iconBtn: {
    width: 22, height: 22,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.95rem", fontWeight: 800,
    padding: 0,
  },
  iconBtnConfirm: { color: "#10b981" },
  iconBtnCancel:  { color: "#f87171" },
  iconBtnBusy:    { opacity: 0.6, cursor: "wait" },

  notes: {
    width: 220,
    fontFamily: "inherit", fontSize: "0.78rem",
    background: "rgba(15,23,42,0.6)",
    color: colors.textSecondary,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 6,
    padding: "0.4rem 0.55rem",
    resize: "vertical",
    textAlign: "left",
  },
};
