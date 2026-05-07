// Renders one of three states: loading spinner, empty/error placeholder
// (with the "eBay pricing not connected yet" message), or a scrollable
// list of sale rows with alternating row backgrounds + gold dividers.

function fmt(n) {
  return n != null
    ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
    : null;
}

function formatSaleDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export default function SalesHistory({ loading, error, sales }) {
  if (loading) {
    return (
      <div style={st.loading}>
        <span style={st.spinner}>●</span>
        <span>Loading sales…</span>
      </div>
    );
  }
  if (error || sales.length === 0) {
    return (
      <div style={st.placeholder}>
        Sales history will be available once eBay pricing is connected.
      </div>
    );
  }
  return (
    <div style={st.list}>
      {sales.map((sale, i) => (
        <div
          key={sale.id ?? i}
          style={{
            ...st.row,
            background: i % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
          }}
        >
          <span style={st.date}>{formatSaleDate(sale.date)}</span>
          <span style={st.grade}>PSA {sale.grade ?? "—"}</span>
          <span style={st.price}>{fmt(sale.price)}</span>
        </div>
      ))}
    </div>
  );
}

const st = {
  loading: {
    display: "flex", alignItems: "center", gap: "0.55rem",
    color: "#64748b", fontSize: "0.82rem",
    padding: "1rem 0",
  },
  spinner: {
    color: "#f59e0b", fontSize: "0.7rem",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  placeholder: {
    background: "rgba(255,255,255,0.02)",
    border: "1px dashed rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "1.25rem 1rem",
    color: "#64748b",
    fontSize: "0.82rem",
    textAlign: "center", fontStyle: "italic",
    letterSpacing: "0.02em",
  },
  list: {
    maxHeight: 260,
    overflowY: "auto",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.01)",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: "0.85rem",
    padding: "0.65rem 0.95rem",
    fontSize: "0.82rem",
    borderBottom: "1px solid rgba(245,158,11,0.08)",
    fontVariantNumeric: "tabular-nums",
  },
  date:  { color: "#cbd5e1" },
  grade: {
    color: "#94a3b8", fontWeight: 700,
    fontSize: "0.7rem",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(245,158,11,0.3)",
    padding: "0.1rem 0.4rem", borderRadius: 3,
    alignSelf: "center",
    letterSpacing: "0.04em",
  },
  price: {
    color: "#f59e0b", fontWeight: 800,
    letterSpacing: "-0.01em",
  },
};
