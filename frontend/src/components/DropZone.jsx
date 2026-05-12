import { useState, useRef, useCallback, useEffect } from "react";

// `verify` is an optional async hook that runs between the user picking
// a file and that file reaching the parent's onFile callback. Shape:
//
//   verify: (file) => Promise<{ allowed: boolean, reason?: string }>
//
// While the promise is in flight, the dropzone shows a "Verifying
// image…" overlay. If the result is allowed=false, the file is dropped
// and a rejection banner is shown until the user picks again. Errors
// from verify itself fail-OPEN (the file is accepted) so a flaky
// moderation API doesn't lock the user out — server-side has separate
// fail-open semantics; this is just defence in depth.
export default function DropZone({ onFile, previewUrl, label, hint, verify }) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [rejection, setRejection] = useState(null); // string | null
  const inputRef = useRef(null);
  const dragCounter = useRef(0);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (!verify) {
      onFile(file);
      return;
    }
    setVerifying(true);
    setRejection(null);
    try {
      const result = await verify(file);
      if (result?.allowed) {
        onFile(file);
      } else {
        setRejection("This image does not appear to be a trading card. Please upload a photo of your card.");
      }
    } catch (err) {
      // Fail open — pass the file through so a moderation outage
      // doesn't block uploads. Server-side guards back this up.
      console.warn("DropZone verify threw, accepting file:", err);
      onFile(file);
    } finally {
      setVerifying(false);
    }
  }, [onFile, verify]);

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
      style={{
        ...st.zone,
        ...stateStyle,
        ...(verifying ? st.zoneVerifying : {}),
        ...(rejection ? st.zoneRejected  : {}),
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => { if (!verifying) inputRef.current?.click(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" && !verifying) inputRef.current?.click(); }}
      aria-label="Upload card image"
      aria-busy={verifying || undefined}
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

      {/* Verifying overlay — sits above whatever the dropzone is
          currently showing (preview or empty state). */}
      {verifying && (
        <div style={st.verifyOverlay}>
          <Spinner />
          <span style={st.verifyText}>Verifying image…</span>
        </div>
      )}

      {/* Rejection banner — persists until the user picks another
          file, at which point handleFile clears it. Click the banner
          itself to dismiss without picking. */}
      {rejection && (
        <div
          style={st.rejectBanner}
          onClick={(e) => { e.stopPropagation(); setRejection(null); }}
        >
          <span>{rejection}</span>
          <span style={st.rejectDismiss} aria-label="Dismiss">×</span>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: "scp-spin 0.9s linear infinite" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(212,175,55,0.2)" strokeWidth="3" />
      <path
        d="M12 3 a9 9 0 0 1 9 9"
        fill="none"
        stroke="#d4af37"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
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
    border: "2px dashed rgba(212,175,55,0.35)",
    borderRadius: 12,
    cursor: "pointer",
    overflow: "hidden",
    transition: "border-color 0.2s, background 0.2s, transform 0.2s, box-shadow 0.2s",
    userSelect: "none",
    outline: "none",
  },
  zoneHovered: {
    borderColor: "rgba(212,175,55,0.7)",
    background: "rgba(15,23,42,0.85)",
    boxShadow: "0 0 0 1px rgba(212,175,55,0.15), 0 0 24px rgba(212,175,55,0.1)",
  },
  zoneDragging: {
    borderColor: "#d4af37",
    background: "rgba(212,175,55,0.08)",
    transform: "scale(1.01)",
    boxShadow: "0 0 0 1px rgba(212,175,55,0.4), 0 0 32px rgba(212,175,55,0.2)",
  },
  zoneVerifying: {
    cursor: "wait",
  },
  zoneRejected: {
    borderColor: "rgba(248,113,113,0.6)",
    boxShadow: "0 0 0 1px rgba(248,113,113,0.2)",
  },
  // Overlay shown while moderation is in flight.
  verifyOverlay: {
    position: "absolute", inset: 0,
    background: "rgba(10,15,31,0.8)",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: "0.6rem",
    pointerEvents: "none",
    zIndex: 2,
  },
  verifyText: {
    color: "#e6c463",
    fontSize: "0.78rem", fontWeight: 800,
    letterSpacing: "0.14em", textTransform: "uppercase",
  },
  // Rejection banner — sits at the top of the zone, dismissible.
  rejectBanner: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    background: "rgba(220,38,38,0.92)",
    color: "#fff",
    padding: "0.7rem 0.9rem",
    fontSize: "0.78rem", fontWeight: 600,
    lineHeight: 1.35,
    display: "flex", alignItems: "flex-start", gap: "0.5rem",
    zIndex: 3,
    cursor: "pointer",
  },
  rejectDismiss: {
    marginLeft: "auto",
    fontSize: "1.1rem", fontWeight: 800,
    lineHeight: 1,
    flexShrink: 0,
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
    color: "#d4af37",
    background: "rgba(212,175,55,0.1)",
    border: "1px solid rgba(212,175,55,0.3)",
    borderRadius: "50%",
    width: 56, height: 56,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "transform 0.2s, background 0.2s",
    marginBottom: "0.4rem",
  },
  iconWrapActive: {
    transform: "scale(1.1)",
    background: "rgba(212,175,55,0.18)",
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
    color: "#d4af37", fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
  },
};
