import { useEffect, useRef, useState } from "react";
import { getCards, deleteCard, getPortfolioValue, updateCardPrice } from "../services/api.js";
import CardModal from "../components/CardModal.jsx";

export default function PortfolioPage() {
  const [cards, setCards] = useState([]);
  const [totalValue, setTotalValue] = useState(null);
  const [cardCount, setCardCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);

  useEffect(() => {
    Promise.all([getCards(), getPortfolioValue()])
      .then(([cardList, valueData]) => {
        // Merge fresh pricing from getPortfolioValue into card list by ID
        const pricingById = Object.fromEntries(valueData.cards.map((c) => [c.id, c]));
        const merged = cardList.map((card) => ({ ...card, ...pricingById[card.id] }));
        setCards(merged);
        setTotalValue(valueData.totalValue);
        setCardCount(merged.length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    if (!window.confirm("Remove this card from your portfolio?")) return;
    await deleteCard(id);
    setCards((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const newTotal = next.reduce((sum, c) => sum + (c.estimatedValue ?? 0), 0);
      setTotalValue(Math.round(newTotal * 100) / 100);
      setCardCount(next.length);
      return next;
    });
  }

  if (loading) return <p style={{ color: "#6b7280", marginTop: "2rem" }}>Loading your portfolio…</p>;
  if (error)   return <p style={{ color: "#dc2626" }}>Error: {error}</p>;

  return (
    <div>
      {/* Stats bar */}
      <div style={styles.statsBar}>
        <StatCard
          label="Total Portfolio Value"
          value={totalValue !== null ? `$${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
          highlight
        />
        <StatCard label="Cards" value={cardCount} />
        <StatCard
          label="Avg Card Value"
          value={
            cardCount > 0 && totalValue !== null
              ? `$${(totalValue / cardCount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
              : "—"
          }
        />
      </div>

      {cards.length === 0 ? (
        <p style={{ color: "#6b7280", marginTop: "2rem" }}>
          No cards yet.{" "}
          <a href="/add-card" style={{ color: "#4f46e5", fontWeight: 500 }}>Add your first card.</a>
        </p>
      ) : (
        <div style={styles.grid}>
          {cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              onDelete={() => handleDelete(card.id)}
              onOpen={() => setSelectedCard(card)}
              onCardUpdate={(id, patch) => {
                // Keep selectedCard in sync so the modal reflects the update
                setSelectedCard((prev) => prev?.id === id ? { ...prev, ...patch } : prev);
                setCards((prev) => {
                  const next = prev.map((c) => c.id === id ? { ...c, ...patch } : c);
                  const newTotal = next.reduce((sum, c) => sum + (c.estimatedValue ?? 0), 0);
                  setTotalValue(Math.round(newTotal * 100) / 100);
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}

      {selectedCard && (
        <CardModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }) {
  return (
    <div style={{ ...styles.statCard, ...(highlight ? styles.statCardHighlight : {}) }}>
      <div style={{ ...styles.statValue, ...(highlight ? styles.statValueHighlight : {}) }}>
        {value}
      </div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

// A card is "rare" if nobody has been graded higher AND the total pop is ≤ 25
function isRare(card) {
  return (
    card.psaPopulationHigher === 0 &&
    card.psaPopulation !== null &&
    card.psaPopulation <= 25
  );
}

function CardTile({ card, onDelete, onOpen, onCardUpdate }) {
  const [flipped, setFlipped]   = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [frontErr, setFrontErr] = useState(false);
  const [backErr, setBackErr]   = useState(false);

  const hasBack = !!card.backImageUrl && !backErr;
  const rare    = isRare(card);

  return (
    <div
      style={{
        ...styles.tile,
        ...(rare    ? styles.tileRare    : {}),
        ...(hovered ? styles.tileHovered : {}),
        cursor: "pointer",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      {/* Flip rig */}
      <div style={styles.flipper}>
        <div style={{ ...styles.flipInner, ...(flipped ? styles.flipInnerFlipped : {}) }}>
          <div style={{ ...styles.face, ...styles.faceFront }}>
            <CardImage url={card.imageUrl}     hasError={frontErr} onError={() => setFrontErr(true)} alt="Front" />
          </div>
          <div style={{ ...styles.face, ...styles.faceBack }}>
            <CardImage url={card.backImageUrl} hasError={backErr}  onError={() => setBackErr(true)}  alt="Back"  />
          </div>
        </div>

        <div style={styles.gradeBadge}>PSA {card.grade}</div>

        {hasBack && (
          <button
            style={{ ...styles.flipBtn, ...(hovered ? styles.btnVisible : {}) }}
            onClick={(e) => { e.stopPropagation(); setFlipped((f) => !f); }}
            title={flipped ? "Show front" : "Show back"}
          >
            {flipped ? "↩ Front" : "↪ Back"}
          </button>
        )}

        <button
          style={{ ...styles.deleteBtn, ...(hovered ? styles.btnVisible : {}) }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Remove card"
        >✕</button>
      </div>

      {/* Info + pricing */}
      <div style={styles.info}>
        <div style={styles.playerNameRow}>
          <div style={styles.playerName}>{card.playerName ?? "Unknown Player"}</div>
          {rare && <span style={styles.rareBadge}>RARE</span>}
        </div>
        <div style={styles.meta}>{[card.year, card.brand].filter(Boolean).join(" · ")}</div>
        {card.cardNumber && <div style={styles.meta}>#{card.cardNumber}</div>}
        <div style={styles.certNumber}>Cert {card.certNumber}</div>

        <PopStats card={card} />
        <PricingSection card={card} onCardUpdate={onCardUpdate} />
      </div>
    </div>
  );
}

function PopStats({ card }) {
  if (card.psaPopulation === null && card.psaPopulationHigher === null) return null;
  const rare = isRare(card);
  return (
    <div style={{ ...styles.popRow, ...(rare ? styles.popRowRare : {}) }}>
      {card.psaPopulation !== null && (
        <span>Pop {card.psaPopulation.toLocaleString()}</span>
      )}
      {card.psaPopulation !== null && card.psaPopulationHigher !== null && (
        <span style={styles.popDivider}>|</span>
      )}
      {card.psaPopulationHigher !== null && (
        <span style={card.psaPopulationHigher === 0 ? styles.popHigherZero : {}}>
          Higher {card.psaPopulationHigher.toLocaleString()}
        </span>
      )}
    </div>
  );
}

function PricingSection({ card, onCardUpdate }) {
  const [editing, setEditing]   = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [saving, setSaving]     = useState(false);
  const inputRef = useRef(null);

  function startEdit(e) {
    e?.stopPropagation();
    const current = card.manualPrice ?? card.estimatedValue ?? "";
    setInputVal(current !== "" ? String(parseFloat(current).toFixed(2)) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEdit() {
    setEditing(false);
    setInputVal("");
  }

  async function commitEdit() {
    const trimmed = inputVal.trim();
    if (trimmed === "") { cancelEdit(); return; }
    const n = parseFloat(trimmed);
    if (isNaN(n) || n < 0) { cancelEdit(); return; }
    setSaving(true);
    try {
      await updateCardPrice(card.id, n);
      onCardUpdate(card.id, { manualPrice: n, estimatedValue: n, priceSource: "manual" });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function clearManual(e) {
    e?.stopPropagation();
    setSaving(true);
    try {
      await updateCardPrice(card.id, null);
      onCardUpdate(card.id, {
        manualPrice: null,
        estimatedValue: card.avgSalePrice,
        priceSource: card.numSales != null ? "mock" : null,
      });
    } finally {
      setSaving(false);
    }
  }

  const fmt = (n) =>
    n != null ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—";

  const displayValue = card.estimatedValue ?? card.avgSalePrice;
  const isManual     = card.priceSource === "manual";

  if (editing) {
    return (
      <div style={styles.pricingBlock} onClick={(e) => e.stopPropagation()}>
        <div style={styles.editRow}>
          <span style={styles.dollarSign}>$</span>
          <input
            ref={inputRef}
            style={styles.priceInput}
            type="number"
            min="0"
            step="0.01"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            disabled={saving}
            autoFocus
          />
          <button style={styles.editConfirm} onClick={commitEdit} disabled={saving} title="Save">✓</button>
          <button style={styles.editCancel} onClick={cancelEdit} disabled={saving} title="Cancel">✕</button>
        </div>
        <p style={styles.editHint}>Enter to save · Esc to cancel</p>
      </div>
    );
  }

  return (
    <div style={styles.pricingBlock}>
      {/* Clickable value */}
      <div style={styles.valueRow}>
        {displayValue != null ? (
          <ValueButton onClick={startEdit} disabled={saving} title="Click to set manual price">
            {fmt(displayValue)}
          </ValueButton>
        ) : (
          <ValueButton onClick={startEdit} disabled={saving} empty>
            Set price
          </ValueButton>
        )}

        {/* Clear override */}
        {isManual && (
          <button
            style={styles.clearBtn}
            onClick={clearManual}
            disabled={saving}
            title="Clear manual override"
          >✕</button>
        )}
      </div>

      {/* Sale details — hidden when manual */}
      {!isManual && (card.numSales != null || card.lastSalePrice != null) && (
        <div style={styles.saleDetail}>
          {card.numSales != null && <span>{card.numSales} sale{card.numSales !== 1 ? "s" : ""}</span>}
          {card.numSales != null && card.lastSalePrice != null && <span style={styles.dot}>·</span>}
          {card.lastSalePrice != null && <span>last {fmt(card.lastSalePrice)}</span>}
        </div>
      )}

      {/* Source badge */}
      {card.priceSource && (
        <span style={{ ...styles.sourceBadge, ...sourceBadgeStyle(card.priceSource) }}>
          {badgeLabel(card.priceSource)}
        </span>
      )}
    </div>
  );
}

function badgeLabel(source) {
  if (source === "manual") return "manual";
  if (source === "ebay")   return "eBay";
  return "est.";
}

function sourceBadgeStyle(source) {
  if (source === "manual") return styles.sourceBadgeManual;
  if (source === "ebay")   return styles.sourceBadgeEbay;
  return styles.sourceBadgeMock;
}

function ValueButton({ children, onClick, disabled, empty, title }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      style={{ ...styles.valueBtn, ...(empty ? styles.valueBtnEmpty : {}) }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {children}
      <span style={{ ...styles.editIcon, opacity: hov ? 1 : 0 }}>✎</span>
    </button>
  );
}

function CardImage({ url, hasError, onError, alt }) {
  if (url && !hasError) {
    return <img src={url} alt={alt} style={styles.cardImg} onError={onError} />;
  }
  return (
    <div style={styles.noImage}>
      <span style={styles.noImageIcon}>🃏</span>
      <span style={styles.noImageText}>{alt} — No Image</span>
    </div>
  );
}

const styles = {
  statsBar: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "1rem",
    marginBottom: "1.75rem",
  },
  statCard: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "1rem 1.25rem",
  },
  statCardHighlight: {
    background: "#eef2ff",
    border: "1px solid #c7d2fe",
  },
  statValue: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#111827",
    lineHeight: 1.2,
  },
  statValueHighlight: { color: "#3730a3" },
  statLabel: { fontSize: "0.78rem", color: "#6b7280", marginTop: "0.2rem" },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "1.25rem",
  },
  tile: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
    overflow: "hidden",
    transition: "box-shadow 0.15s, transform 0.15s",
  },
  tileHovered: {
    boxShadow: "0 6px 20px rgba(0,0,0,0.13)",
    transform: "translateY(-2px)",
  },

  flipper: { position: "relative", width: "100%", paddingTop: "140%", perspective: "1000px" },
  flipInner: {
    position: "absolute", inset: 0,
    transformStyle: "preserve-3d",
    transition: "transform 0.5s cubic-bezier(0.4,0,0.2,1)",
  },
  flipInnerFlipped: { transform: "rotateY(180deg)" },
  face: {
    position: "absolute", inset: 0,
    backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
    overflow: "hidden", background: "#f3f4f6",
  },
  faceFront: {},
  faceBack:  { transform: "rotateY(180deg)" },
  cardImg:   { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  noImage: {
    width: "100%", height: "100%",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "0.4rem",
  },
  noImageIcon: { fontSize: "2.5rem", opacity: 0.25 },
  noImageText: { fontSize: "0.72rem", color: "#9ca3af" },

  gradeBadge: {
    position: "absolute", bottom: 8, left: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff",
    fontSize: "0.72rem", fontWeight: 700,
    padding: "0.2rem 0.5rem", borderRadius: 4,
    backdropFilter: "blur(4px)", pointerEvents: "none",
  },
  flipBtn: {
    position: "absolute", bottom: 8, right: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff", border: "none",
    borderRadius: 4, fontSize: "0.72rem", fontWeight: 600,
    padding: "0.25rem 0.5rem", cursor: "pointer",
    opacity: 0, transition: "opacity 0.15s", backdropFilter: "blur(4px)",
  },
  deleteBtn: {
    position: "absolute", top: 6, right: 6,
    background: "rgba(0,0,0,0.5)", color: "#fff", border: "none",
    borderRadius: "50%", width: 24, height: 24, fontSize: "0.7rem",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    opacity: 0, transition: "opacity 0.15s",
  },
  btnVisible: { opacity: 1 },

  info:       { padding: "0.75rem" },
  playerNameRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.4rem", marginBottom: "0.2rem" },
  playerName: { fontWeight: 600, fontSize: "0.9rem", lineHeight: 1.3, flex: 1 },
  rareBadge: {
    flexShrink: 0,
    fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em",
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#fff",
    padding: "0.15rem 0.4rem", borderRadius: 3,
    boxShadow: "0 1px 3px rgba(217,119,6,0.4)",
    alignSelf: "center",
  },
  meta:       { fontSize: "0.76rem", color: "#6b7280", lineHeight: 1.4 },
  certNumber: { fontSize: "0.72rem", color: "#9ca3af", marginTop: "0.2rem" },
  valueUnknown: { fontSize: "0.8rem", color: "#9ca3af", marginTop: "0.5rem" },

  // Rarity tile highlight
  tileRare: {
    boxShadow: "0 0 0 2px #f59e0b, 0 1px 4px rgba(0,0,0,0.08)",
  },

  // Population stats
  popRow: {
    display: "flex", alignItems: "center", gap: "0.3rem",
    fontSize: "0.72rem", color: "#6b7280",
    marginTop: "0.35rem",
  },
  popRowRare: { color: "#d97706", fontWeight: 600 },
  popDivider: { color: "#d1d5db" },
  popHigherZero: { color: "#059669", fontWeight: 700 },

  pricingBlock: { marginTop: "0.5rem" },
  mainValue: { fontWeight: 700, fontSize: "1.1rem", color: "#111827" },
  saleDetail: {
    display: "flex", alignItems: "center", gap: "0.3rem",
    fontSize: "0.72rem", color: "#6b7280", marginTop: "0.15rem",
  },
  dot: { color: "#d1d5db" },
  sourceBadge: {
    display: "inline-block", marginTop: "0.3rem",
    fontSize: "0.65rem", fontWeight: 600,
    padding: "0.1rem 0.4rem", borderRadius: 3,
    textTransform: "uppercase", letterSpacing: "0.04em",
  },
  sourceBadgeMock:   { background: "#f3f4f6", color: "#9ca3af" },
  sourceBadgeEbay:   { background: "#fef3c7", color: "#92400e" },
  sourceBadgeManual: { background: "#ede9fe", color: "#5b21b6" },

  // Inline price editor
  valueRow: { display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.5rem" },
  valueBtn: {
    display: "flex", alignItems: "center", gap: "0.3rem",
    background: "none", border: "none", padding: 0,
    fontWeight: 700, fontSize: "1.1rem", color: "#111827",
    cursor: "pointer", lineHeight: 1,
  },
  valueBtnEmpty: { fontSize: "0.82rem", color: "#9ca3af", fontWeight: 500 },
  editIcon: { fontSize: "0.75rem", color: "#9ca3af", opacity: 0, transition: "opacity 0.1s" },
  clearBtn: {
    background: "none", border: "none", color: "#9ca3af",
    fontSize: "0.72rem", cursor: "pointer", padding: "0 0.1rem", lineHeight: 1,
  },
  editRow: { display: "flex", alignItems: "center", gap: "0.25rem", marginTop: "0.5rem" },
  dollarSign: { fontSize: "0.9rem", color: "#6b7280", fontWeight: 600 },
  priceInput: {
    width: 72, padding: "0.25rem 0.35rem",
    border: "1px solid #a5b4fc", borderRadius: 4,
    fontSize: "0.9rem", fontWeight: 600,
    outline: "none",
    MozAppearance: "textfield",
  },
  editConfirm: {
    background: "#4f46e5", color: "#fff", border: "none",
    borderRadius: 4, width: 22, height: 22, fontSize: "0.75rem",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  editCancel: {
    background: "#f3f4f6", color: "#6b7280", border: "none",
    borderRadius: 4, width: 22, height: 22, fontSize: "0.72rem",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  editHint: { fontSize: "0.65rem", color: "#9ca3af", marginTop: "0.25rem" },
};
