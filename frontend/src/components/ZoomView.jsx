import { useEffect, useRef, useState } from "react";

// Fullscreen image overlay with a magnifier lens that follows the cursor.
// Bypassing the lens (mouse leave) returns to a normal view; Escape or
// clicking the backdrop closes.
const LENS_D   = 150;
const LENS_R   = LENS_D / 2;
const LENS_MAG = 2.5;

export default function ZoomView({ src, alt, onClose }) {
  const [lens, setLens] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleMouseMove(e) {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLens({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height });
  }

  return (
    <div style={st.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button style={st.closeBtn} onClick={onClose} aria-label="Close zoom">✕</button>
      <div style={{ position: "relative", lineHeight: 0 }}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          style={{ ...st.img, cursor: lens ? "none" : "crosshair" }}
          draggable={false}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setLens(null)}
        />
        {lens && (
          <div style={{
            position: "absolute",
            left: lens.x - LENS_R,
            top:  lens.y - LENS_R,
            width:  LENS_D,
            height: LENS_D,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.65)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.15)",
            backgroundImage: `url(${src})`,
            backgroundRepeat: "no-repeat",
            backgroundSize:     `${lens.w * LENS_MAG}px ${lens.h * LENS_MAG}px`,
            backgroundPosition: `${LENS_R - lens.x * LENS_MAG}px ${LENS_R - lens.y * LENS_MAG}px`,
            pointerEvents: "none",
          }} />
        )}
      </div>
    </div>
  );
}

const st = {
  backdrop: {
    position: "fixed", inset: 0, zIndex: 2000,
    background: "rgba(0,0,0,0.96)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "2rem",
  },
  closeBtn: {
    position: "absolute", top: 16, right: 16, zIndex: 1,
    background: "rgba(255,255,255,0.12)", border: "none", borderRadius: "50%",
    width: 40, height: 40, color: "#fff", fontSize: "1rem", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  img: {
    maxWidth: "90vw", maxHeight: "90vh",
    objectFit: "contain", borderRadius: 8,
    boxShadow: "0 8px 60px rgba(0,0,0,0.6)",
  },
};
