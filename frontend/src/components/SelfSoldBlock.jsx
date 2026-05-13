// Read-only display of self-sold details. Sibling to MarkSoldBlock —
// the block the user sees in CardModal after they've marked a card as
// sold via that flow. Lives in the same modal slot where ConsignBlock's
// StatusPill renders for consignment-sold cards.
//
// Visibility: parent (CardModal) gates on card.status === 'sold' AND
// card.soldPrice != null. This component does not re-check; it trusts
// the parent gate.
//
// Visual treatment:
//   - Green "Sold" pill at the top, copied from ConsignBlock's
//     STATUS_VARIANTS.sold so the sold-state visual language is
//     consistent across both sold paths (self-sold + consignment-sold).
//     Green ≠ gold, so the no-gold-on-self-sold rule still holds.
//   - Slate-tinted body underneath with three rows: Sold For, Sold On,
//     Sold At. Slate so the block feels visually paired with
//     MarkSoldBlock — the write affordance and the read affordance
//     read as siblings of the same flow.
export default function SelfSoldBlock({
  soldPrice,
  soldAt,
  venueType,
  showName,
  showDate,
  auctionHouse,
  otherText,
}) {
  return (
    <div style={st.block}>
      <div style={st.pill}>
        <span style={st.pillDot} />
        <span>Sold</span>
      </div>
      <div style={st.body}>
        <Row label="Sold For" value={fmtUsd(soldPrice)} valueStyle={st.priceValue} />
        <Row label="Sold On" value={fmtDate(soldAt)} />
        <Row label="Sold At" value={fmtVenue({ venueType, showName, showDate, auctionHouse, otherText })} />
      </div>
    </div>
  );
}

function Row({ label, value, valueStyle }) {
  return (
    <div style={st.row}>
      <span style={st.rowLabel}>{label}</span>
      <span style={{ ...st.rowValue, ...(valueStyle ?? {}) }}>{value}</span>
    </div>
  );
}

function fmtUsd(n) {
  if (n == null) return "—";
  return `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Parse YYYY-MM-DD into a local Date by component construction rather
// than letting Date parse the ISO string. The string-parse path treats
// the date as UTC midnight and then renders in the user's local TZ,
// which can shift a US-Eastern user's "May 9" to "May 8" in display.
// Constructing from (year, month-1, day) anchors at local midnight.
function fmtDate(s) {
  if (!s) return "—";
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return s;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// Render the venue per type. For show sales, the dropdown's selected
// label format ("Name · Date") is reused so the display recalls what
// the user picked. The OQ-1 ON DELETE SET NULL case is handled when
// showName is null (show row was deleted between sale and view).
function fmtVenue({ venueType, showName, showDate, auctionHouse, otherText }) {
  switch (venueType) {
    case "show":
      if (!showName) return "A show (name unavailable)";
      return showDate
        ? `${showName} · ${fmtDate(showDate)}`
        : showName;
    case "auction":
      return auctionHouse ?? "Auction (unspecified)";
    case "other":
      return otherText ?? "—";
    default:
      return "—";
  }
}

const st = {
  // Outer block — sits in the same modal slot ConsignBlock occupies for
  // consignment-sold cards. Marginnings match ConsignBlock's statusBlock
  // so the vertical rhythm of the sold-state region is identical between
  // the two paths.
  block: {
    marginTop: "1.5rem", marginBottom: "0.5rem",
  },

  // Green "Sold" pill — values copied from ConsignBlock STATUS_VARIANTS.sold
  // so the two sold-state paths render the same pill chrome. Green is the
  // only non-slate color in this component, semantically paired with
  // ConsignBlock's sold pill (not with gold-tier portfolio displays).
  pill: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    padding: "0.7rem 1rem",
    borderRadius: 10,
    background: "rgba(16,185,129,0.12)",
    border: "1px solid rgba(16,185,129,0.5)",
    color: "#6ee7b7",
    fontSize: "0.78rem", fontWeight: 700,
    letterSpacing: "0.04em",
  },
  pillDot: {
    width: 8, height: 8, borderRadius: "50%",
    background: "#10b981",
    flexShrink: 0,
  },

  // ─── Body block (slate, paired with MarkSoldBlock form chrome) ─────
  body: {
    marginTop: "0.55rem",
    background: "rgba(148, 163, 184, 0.04)",
    border: "1px solid rgba(148, 163, 184, 0.20)",
    borderRadius: 10,
    padding: "0.85rem 1rem 0.95rem",
    display: "flex", flexDirection: "column", gap: "0.55rem",
  },
  row: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    gap: "1rem",
  },
  rowLabel: {
    color: "#94a3b8",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    flexShrink: 0,
  },
  rowValue: {
    color: "#e2e8f0",
    fontSize: "0.92rem", fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
    textAlign: "right",
  },
  // Price row gets slightly more weight + a brighter slate so the
  // realized number reads as the primary fact in the block, without
  // resorting to gold (reserved for portfolio-value displays per
  // MASTER §3.2 and explicitly excluded from self-sold per spec).
  priceValue: {
    color: "#f1f5f9",
    fontSize: "1.05rem", fontWeight: 800,
  },
};
