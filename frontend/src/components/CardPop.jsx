import { useEffect } from "react";

// Click-to-zoom pop. Always mounted; toggles visibility via opacity +
// pointer-events instead of mount/unmount to avoid React reconciliation cost
// per open. Transform + opacity only — no layout-triggering properties —
// so the animation runs entirely on the GPU compositor. backdrop-filter
// intentionally dropped (full-screen blur is one of the most expensive
// effects a browser can render).
export default function CardPop({ open, src, alt, onClose }) {
  // Escape closes only when open
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll lock only when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div
      style={{
        ...st.backdrop,
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
      }}
      onClick={onClose}
      role="dialog"
      aria-hidden={!open}
    >
      {src && (
        <img
          src={src}
          alt={alt ?? ""}
          draggable={false}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            ...st.image,
            transform: open ? "scale(1)" : "scale(0.1)",
          }}
        />
      )}
    </div>
  );
}

const st = {
  backdrop: {
    position: "fixed", inset: 0, zIndex: 3000,
    background: "rgba(0,0,0,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "opacity 250ms ease-out",
    cursor: "zoom-out",
  },
  image: {
    maxWidth: "82vw", maxHeight: "85vh",
    width: "auto", height: "auto",
    display: "block",
    borderRadius: 14,
    boxShadow:
      "0 30px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)",
    cursor: "zoom-out",
    transition: "transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    willChange: "transform",
  },
};
