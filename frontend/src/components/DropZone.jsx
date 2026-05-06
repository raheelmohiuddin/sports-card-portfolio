import { useState, useRef, useCallback, useEffect } from "react";

export default function DropZone({ onFile, previewUrl, label, hint }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const dragCounter = useRef(0); // counter prevents flicker when dragging over children

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    onFile(file);
  }, [onFile]);

  const onDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const onDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const onInputChange = (e) => {
    handleFile(e.target.files?.[0]);
    // Reset so the same file can be re-selected after clearing
    e.target.value = "";
  };

  // Revoke the object URL on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div
      style={{ ...styles.zone, ...(dragging ? styles.zoneDragging : {}) }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
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
        <div style={styles.previewWrap}>
          <img src={previewUrl} alt="Preview" style={styles.previewImg} />
          <span style={styles.changeHint}>Click or drop to replace</span>
        </div>
      ) : (
        <div style={styles.emptyContent}>
          <div style={{ ...styles.icon, ...(dragging ? styles.iconDragging : {}) }}>
            {dragging ? "📂" : "🖼"}
          </div>
          <p style={styles.labelText}>{label ?? "Drop image here"}</p>
          <p style={styles.hintText}>{hint ?? "or click to browse — JPEG, PNG, WebP"}</p>
        </div>
      )}
    </div>
  );
}

const styles = {
  zone: {
    border: "2px dashed #d1d5db",
    borderRadius: 10,
    padding: "1.5rem",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
    background: "#fafafa",
    userSelect: "none",
    outline: "none",
  },
  zoneDragging: {
    borderColor: "#4f46e5",
    background: "#eef2ff",
  },
  emptyContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.4rem",
    pointerEvents: "none",
  },
  icon: {
    fontSize: "2rem",
    lineHeight: 1,
    transition: "transform 0.15s",
  },
  iconDragging: {
    transform: "scale(1.2)",
  },
  labelText: {
    fontWeight: 600,
    color: "#374151",
    fontSize: "0.95rem",
    margin: 0,
  },
  hintText: {
    color: "#9ca3af",
    fontSize: "0.8rem",
    margin: 0,
  },
  previewWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
    pointerEvents: "none",
  },
  previewImg: {
    maxHeight: 220,
    maxWidth: "100%",
    borderRadius: 6,
    objectFit: "contain",
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  },
  changeHint: {
    fontSize: "0.78rem",
    color: "#9ca3af",
  },
};
