import { useState, useRef, useCallback, useEffect } from "react";

export default function DropZone({ onFile, previewUrl, label, hint }) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const inputRef = useRef(null);
  const dragCounter = useRef(0);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    onFile(file);
  }, [onFile]);

  const onDragEnter = (e) => { e.preventDefault(); dragCounter.current++; setDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); };
  const onDragOver  = (e) => { e.preventDefault(); };
  const onDrop      = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };
  const onInputChange = (e) => {
    handleFile(e.target.files?.[0]);
    e.target.value = "";
  };

  useEffect(() => () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const stateStyle = dragging
    ? st.zoneDragging
    : hovered
      ? st.zoneHovered
      : {};

  return (
    <div
      style={{ ...st.zone, ...stateStyle }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      aria-label="Upload card image"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={onInputChange}
      />

      {previewUrl ? (
        <>
          <img src={previewUrl} alt="Preview" style={st.previewImg} draggable={false} />
          <div style={{ ...st.previewOverlay, opacity: hovered ? 1 : 0 }}>
            <span style={st.replaceText}>Click or drop to replace</span>
          </div>
        </>
      ) : (
        <div style={st.empty}>
          <div style={{ ...st.iconWrap, ...(dragging ? st.iconWrapActive : {}) }}>
            <UploadIcon />
          </div>
          <p style={st.label}>{label ?? "Drop image here"}</p>
          <p style={st.hint}>{hint ?? "or click to browse · JPEG · PNG · WebP"}</p>
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="34" height="34"
      fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

const st = {
  zone: {
    position: "relative",
    width: "100%",
    aspectRatio: "5 / 7",
    background: "rgba(15,23,42,0.6)",
    border: "2px dashed rgba(245,158,11,0.35)",
    borderRadius: 12,
    cursor: "pointer",
    overflow: "hidden",
    transition: "border-color 0.2s, background 0.2s, transform 0.2s, box-shadow 0.2s",
    userSelect: "none",
    outline: "none",
  },
  zoneHovered: {
    borderColor: "rgba(245,158,11,0.7)",
    background: "rgba(15,23,42,0.85)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.15), 0 0 24px rgba(245,158,11,0.1)",
  },
  zoneDragging: {
    borderColor: "#f59e0b",
    background: "rgba(245,158,11,0.08)",
    transform: "scale(1.01)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.4), 0 0 32px rgba(245,158,11,0.2)",
  },
  empty: {
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: "0.6rem", padding: "1rem",
    pointerEvents: "none",
    textAlign: "center",
  },
  iconWrap: {
    color: "#f59e0b",
    background: "rgba(245,158,11,0.1)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: "50%",
    width: 56, height: 56,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "transform 0.2s, background 0.2s",
    marginBottom: "0.4rem",
  },
  iconWrapActive: {
    transform: "scale(1.1)",
    background: "rgba(245,158,11,0.18)",
  },
  label: {
    fontSize: "0.85rem", fontWeight: 600,
    color: "#e2e8f0", margin: 0,
    letterSpacing: "0.01em",
  },
  hint: {
    fontSize: "0.7rem", color: "#64748b",
    margin: 0, letterSpacing: "0.04em",
  },
  previewImg: {
    position: "absolute", inset: 0,
    width: "100%", height: "100%",
    objectFit: "cover", display: "block",
  },
  previewOverlay: {
    position: "absolute", inset: 0,
    background: "linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.7))",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    padding: "1rem", pointerEvents: "none",
    transition: "opacity 0.2s",
  },
  replaceText: {
    color: "#f59e0b", fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
  },
};
