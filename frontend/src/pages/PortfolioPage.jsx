import { useEffect, useState } from "react";
import { getCards, deleteCard, getPortfolioValue } from "../services/api.js";

export default function PortfolioPage() {
  const [cards, setCards] = useState([]);
  const [totalValue, setTotalValue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getCards(), getPortfolioValue()])
      .then(([cardList, valueData]) => {
        setCards(cardList);
        setTotalValue(valueData.totalValue);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    if (!window.confirm("Remove this card from your portfolio?")) return;
    await deleteCard(id);
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  if (loading) return <p style={{ color: "#6b7280", marginTop: "2rem" }}>Loading your portfolio…</p>;
  if (error) return <p style={{ color: "#dc2626" }}>Error: {error}</p>;

  return (
    <div>
      <div style={styles.pageHeader}>
        <h1 style={styles.title}>My Portfolio</h1>
        {totalValue !== null && (
          <div style={styles.valueBadge}>
            Est. Value&nbsp;
            <strong>${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
          </div>
        )}
      </div>

      {cards.length === 0 ? (
        <p style={{ color: "#6b7280", marginTop: "2rem" }}>
          No cards yet.{" "}
          <a href="/add-card" style={{ color: "#4f46e5", fontWeight: 500 }}>Add your first card.</a>
        </p>
      ) : (
        <div style={styles.grid}>
          {cards.map((card) => (
            <CardTile key={card.id} card={card} onDelete={() => handleDelete(card.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardTile({ card, onDelete }) {
  const [flipped, setFlipped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [frontErr, setFrontErr] = useState(false);
  const [backErr, setBackErr] = useState(false);

  const hasBack = !!card.backImageUrl && !backErr;
  const canFlip = hasBack || !!card.imageUrl; // at least two sides needed to flip

  function handleFlip(e) {
    e.stopPropagation();
    if (hasBack) setFlipped((f) => !f);
  }

  return (
    <div
      style={{ ...styles.tile, ...(hovered ? styles.tileHovered : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 3-D flip container */}
      <div style={styles.flipper}>
        <div style={{ ...styles.flipInner, ...(flipped ? styles.flipInnerFlipped : {}) }}>

          {/* FRONT FACE */}
          <div style={{ ...styles.face, ...styles.faceFront }}>
            <CardImage
              url={card.imageUrl}
              hasError={frontErr}
              onError={() => setFrontErr(true)}
              alt="Front"
            />
          </div>

          {/* BACK FACE */}
          <div style={{ ...styles.face, ...styles.faceBack }}>
            <CardImage
              url={card.backImageUrl}
              hasError={backErr}
              onError={() => setBackErr(true)}
              alt="Back"
            />
          </div>
        </div>

        {/* Grade badge */}
        <div style={styles.gradeBadge}>PSA {card.grade}</div>

        {/* Flip button — only shown when a back image exists */}
        {hasBack && (
          <button
            style={{ ...styles.flipBtn, ...(hovered ? styles.flipBtnVisible : {}) }}
            onClick={handleFlip}
            title={flipped ? "Show front" : "Show back"}
          >
            {flipped ? "↩ Front" : "↪ Back"}
          </button>
        )}

        {/* Delete button */}
        <button
          style={{ ...styles.deleteBtn, ...(hovered ? styles.deleteBtnVisible : {}) }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Remove card"
        >
          ✕
        </button>
      </div>

      {/* Info */}
      <div style={styles.info}>
        <div style={styles.playerName}>{card.playerName ?? "Unknown Player"}</div>
        <div style={styles.meta}>{[card.year, card.brand].filter(Boolean).join(" · ")}</div>
        {card.cardNumber && <div style={styles.meta}>#{card.cardNumber}</div>}
        <div style={styles.certNumber}>Cert {card.certNumber}</div>
        {card.estimatedValue !== null
          ? <div style={styles.value}>${parseFloat(card.estimatedValue).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
          : <div style={styles.valueUnknown}>Value N/A</div>
        }
      </div>
    </div>
  );
}

function CardImage({ url, hasError, onError, alt }) {
  if (url && !hasError) {
    return (
      <img
        src={url}
        alt={alt}
        style={styles.cardImg}
        onError={onError}
      />
    );
  }
  return (
    <div style={styles.noImage}>
      <span style={styles.noImageIcon}>🃏</span>
      <span style={styles.noImageText}>{alt} — No Image</span>
    </div>
  );
}

const styles = {
  pageHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem",
  },
  title: { fontSize: "1.5rem", fontWeight: 700 },
  valueBadge: {
    background: "#eef2ff", color: "#3730a3",
    padding: "0.5rem 1.1rem", borderRadius: 20, fontSize: "0.95rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "1.25rem",
  },
  tile: {
    background: "#fff", borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden",
    transition: "box-shadow 0.15s, transform 0.15s",
  },
  tileHovered: {
    boxShadow: "0 6px 20px rgba(0,0,0,0.13)",
    transform: "translateY(-2px)",
  },

  // Flip rig
  flipper: {
    position: "relative",
    width: "100%",
    paddingTop: "140%",           // 5:7 card aspect ratio
    perspective: "1000px",
  },
  flipInner: {
    position: "absolute",
    inset: 0,
    transformStyle: "preserve-3d",
    transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  flipInnerFlipped: {
    transform: "rotateY(180deg)",
  },
  face: {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    overflow: "hidden",
    background: "#f3f4f6",
  },
  faceFront: {},
  faceBack: {
    transform: "rotateY(180deg)",
  },
  cardImg: {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
  },
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
    backdropFilter: "blur(4px)",
    pointerEvents: "none",
  },
  flipBtn: {
    position: "absolute", bottom: 8, right: 8,
    background: "rgba(0,0,0,0.6)", color: "#fff",
    border: "none", borderRadius: 4,
    fontSize: "0.72rem", fontWeight: 600,
    padding: "0.25rem 0.5rem", cursor: "pointer",
    opacity: 0, transition: "opacity 0.15s",
    backdropFilter: "blur(4px)",
  },
  flipBtnVisible: { opacity: 1 },
  deleteBtn: {
    position: "absolute", top: 6, right: 6,
    background: "rgba(0,0,0,0.5)", color: "#fff",
    border: "none", borderRadius: "50%",
    width: 24, height: 24, fontSize: "0.7rem",
    cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center",
    opacity: 0, transition: "opacity 0.15s",
  },
  deleteBtnVisible: { opacity: 1 },
  info: { padding: "0.75rem" },
  playerName: { fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.2rem", lineHeight: 1.3 },
  meta: { fontSize: "0.76rem", color: "#6b7280", lineHeight: 1.4 },
  certNumber: { fontSize: "0.72rem", color: "#9ca3af", marginTop: "0.25rem" },
  value: { fontWeight: 700, color: "#047857", fontSize: "0.95rem", marginTop: "0.4rem" },
  valueUnknown: { fontSize: "0.8rem", color: "#9ca3af", marginTop: "0.4rem" },
};
