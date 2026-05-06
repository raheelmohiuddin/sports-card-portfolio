import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { generateEdgeTexture, getCard } from "../services/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRare(card) {
  return card.psaPopulationHigher === 0 && card.psaPopulation !== null && card.psaPopulation <= 25;
}

function fmt(n) {
  return n != null ? `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null;
}

// Load a texture from a URL; resolves to null on error or missing URL.
//
// We fetch via fetch() rather than letting Three.js use an <img> element directly.
// If the browser has already loaded this URL as a plain <img> (no crossOrigin attr,
// e.g. from the portfolio grid), it caches the response without CORS headers. Three.js
// then requests the same URL with crossOrigin="anonymous", hits the cached entry, and
// the CORS check fails → blank face. Using fetch() issues an independent CORS request
// that bypasses the image cache, then feeds a same-origin blob URL to Three.js.
async function loadTexture(url) {
  if (!url) return null;
  let objectUrl = null;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) {
      console.warn(`[CardModal] Texture fetch failed: HTTP ${res.status} — ${url}`);
      return null;
    }
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      new THREE.TextureLoader().load(
        objectUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          URL.revokeObjectURL(objectUrl);
          resolve(tex);
        },
        undefined,
        (err) => {
          console.warn("[CardModal] Three.js texture decode failed:", err);
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        }
      );
    });
  } catch (err) {
    console.warn("[CardModal] Texture load error:", err.message, "—", url);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fullscreen zoom overlay
// ---------------------------------------------------------------------------

const LENS_D = 150;
const LENS_R = LENS_D / 2;
const LENS_MAG = 2.5;

function ZoomView({ src, alt, onClose }) {
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
    <div style={zoomSt.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button style={zoomSt.closeBtn} onClick={onClose} aria-label="Close zoom">✕</button>
      <div style={{ position: "relative", lineHeight: 0 }}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          style={{ ...zoomSt.img, cursor: lens ? "none" : "crosshair" }}
          draggable={false}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setLens(null)}
        />
        {lens && (
          <div style={{
            position: "absolute",
            left: lens.x - LENS_R,
            top: lens.y - LENS_R,
            width: LENS_D,
            height: LENS_D,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.65)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.15)",
            backgroundImage: `url(${src})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${lens.w * LENS_MAG}px ${lens.h * LENS_MAG}px`,
            backgroundPosition: `${LENS_R - lens.x * LENS_MAG}px ${LENS_R - lens.y * LENS_MAG}px`,
            pointerEvents: "none",
          }} />
        )}
      </div>
    </div>
  );
}

const zoomSt = {
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

// ---------------------------------------------------------------------------
// Three.js card renderer
// ---------------------------------------------------------------------------

// BoxGeometry face indices: 0=+X(R), 1=-X(L), 2=+Y(T), 3=-Y(B), 4=+Z(Front), 5=-Z(Back)
const FACE_FRONT = 4;
const FACE_BACK  = 5;
const CARD_W = 2.5, CARD_H = 3.5, CARD_D = 0.04; // 0.04 — thick enough to see edges clearly
// Module-level cache keyed by card ID — persists across modal open/close
// so Claude is only called once per card per browser session.
const edgeColorCache = new Map();

async function fetchEdgeColors(cardId, imageUrl) {
  if (edgeColorCache.has(cardId)) return edgeColorCache.get(cardId);
  try {
    const result = await generateEdgeTexture(imageUrl);
    edgeColorCache.set(cardId, result);
    return result;
  } catch {
    const fallback = { edgeColor: "#f2f0eb", texture: "white" };
    edgeColorCache.set(cardId, fallback);
    return fallback;
  }
}

// Generate a canvas-based paper texture from the analysed edge colour.
// 256×16 px with additive noise and a depth gradient — tiles seamlessly.
function buildEdgeTexture(hexColor) {
  const W = 256, H = 16;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = hexColor;
  ctx.fillRect(0, 0, W, H);

  // Paper-fibre grain
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    d[i]   = Math.max(0, Math.min(255, d[i]   + n));
    d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
    d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
  }
  ctx.putImageData(img, 0, 0);

  // Depth gradient: lighter on top edge, darker on bottom
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   "rgba(255,255,255,0.16)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1,   "rgba(0,0,0,0.16)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function useThreeCard({ canvasRef, cardId, frontUrl, backUrl }) {
  const [loading, setLoading] = useState(true);
  const meshRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frameId;
    let disposed = false;

    async function init() {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;

      // Renderer — transparent background so radial gradient shows through
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const scene = new THREE.Scene();

      // Camera: FOV chosen so card fills ~80% of viewport height with breathing room
      const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
      camera.position.z = 6;

      // Lighting ─ ambient for overall fill, directional key light, soft back fill
      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(3, 5, 6);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xdde8f0, 0.35);
      fillLight.position.set(-4, -3, -5);
      scene.add(fillLight);

      // Edge material — slightly warm off-white like real card stock
      // Load textures and fetch edge colour from Claude in parallel —
      // edge analysis adds zero wall-clock time beyond texture loading.
      const [frontTex, backTex, edgeData] = await Promise.all([
        loadTexture(frontUrl),
        loadTexture(backUrl),
        cardId && frontUrl ? fetchEdgeColors(cardId, frontUrl) : Promise.resolve(null),
      ]);

      if (disposed) {
        renderer.dispose();
        [frontTex, backTex].forEach((t) => t?.dispose());
        return;
      }

      const edgeTex = buildEdgeTexture(edgeData?.edgeColor ?? "#f2f0eb");
      const edgeMat = new THREE.MeshLambertMaterial({ map: edgeTex });

      const faceMat = (tex) =>
        tex
          ? new THREE.MeshLambertMaterial({ map: tex })
          : new THREE.MeshLambertMaterial({ color: 0xfaf9f7 });

      // Material array order must match BoxGeometry face indices
      const materials = [
        edgeMat,          // 0 Right
        edgeMat,          // 1 Left
        edgeMat,          // 2 Top
        edgeMat,          // 3 Bottom
        faceMat(frontTex),// 4 Front (+Z)
        faceMat(backTex), // 5 Back  (-Z)
      ];

      const geometry = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D);
      const mesh = new THREE.Mesh(geometry, materials);
      scene.add(mesh);
      meshRef.current = mesh;

      setLoading(false);

      function tick() {
        frameId = requestAnimationFrame(tick);
        renderer.render(scene, camera);
      }

      tick();

      // Store renderer for cleanup
      canvas._threeRenderer = renderer;
    }

    init();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      meshRef.current = null;
      if (canvas._threeRenderer) {
        canvas._threeRenderer.dispose();
        canvas._threeRenderer = null;
      }
    };
  // Re-init when the card changes (new modal open)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, frontUrl, backUrl]);

  return { loading, meshRef };
}

// ---------------------------------------------------------------------------
// Card viewport component
// ---------------------------------------------------------------------------

function CardViewport({ card, onZoom }) {
  const canvasRef  = useRef(null);
  const [hovered, setHovered] = useState(false);
  // Start with null URLs — replaced by freshly-signed ones from the API.
  // Each new pre-signed URL has a unique signature string, so it's never
  // the same URL the browser may have cached without CORS headers.
  const [freshUrls, setFreshUrls] = useState({ front: null, back: null });

  useEffect(() => {
    let cancelled = false;
    getCard(card.id)
      .then((fresh) => {
        if (!cancelled) setFreshUrls({ front: fresh.imageUrl ?? null, back: fresh.backImageUrl ?? null });
      })
      .catch(() => {
        // Fall back to whatever URLs the portfolio already has
        if (!cancelled) setFreshUrls({ front: card.imageUrl ?? null, back: card.backImageUrl ?? null });
      });
    return () => { cancelled = true; };
  }, [card.id]);

  const { loading, meshRef } = useThreeCard({
    canvasRef,
    cardId:   card.id,
    frontUrl: freshUrls.front,
    backUrl:  freshUrls.back,
  });

  function handleMouseEnter() { setHovered(true);  }
  function handleMouseLeave() { setHovered(false); }

  function handleClick() {
    const mesh = meshRef.current;
    if (!mesh) return;
    // cos(rotationY) > 0 → front face (+Z) is toward camera
    const showingFront = Math.cos(mesh.rotation.y) > 0;
    if (showingFront && card.imageUrl) {
      onZoom({ src: card.imageUrl, alt: `${card.playerName} — Front` });
    } else if (!showingFront && card.backImageUrl) {
      onZoom({ src: card.backImageUrl, alt: `${card.playerName} — Back` });
    } else if (card.imageUrl) {
      onZoom({ src: card.imageUrl, alt: card.playerName });
    }
  }

  return (
    <div
      style={st.spotlight}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Canvas fills the spotlight container */}
      <canvas
        ref={canvasRef}
        style={st.canvas}
        title={hovered ? "Click to zoom" : undefined}
      />

      {/* Loading state */}
      {loading && (
        <div style={st.loadingOverlay}>
          <span style={st.loadingDot}>●</span>
        </div>
      )}

      {/* Hover hint */}
      {hovered && !loading && (
        <div style={st.hoverHint}>
          <span style={st.hoverHintText}>🔍 Click to zoom</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export default function CardModal({ card, onClose }) {
  const [zoomSrc, setZoomSrc] = useState(null);
  const contentRef = useRef(null);
  const rare = isRare(card);

  // Close on Escape (only when zoom is not open)
  useEffect(() => {
    if (zoomSrc) return;
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomSrc]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  function handleBackdrop(e) {
    if (!contentRef.current?.contains(e.target)) onClose();
  }

  const displayValue = card.estimatedValue ?? card.avgSalePrice;

  return (
    <>
      <div style={st.backdrop} onClick={handleBackdrop}>
        <div ref={contentRef} style={{ ...st.modal, ...(rare ? st.modalRare : {}) }}>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close">✕</button>

          <div style={st.body}>
            {/* ── Left: Three.js card ── */}
            <div style={st.imageCol}>
              <CardViewport card={card} onZoom={setZoomSrc} />

              <div style={{ ...st.gradeBadge, ...(rare ? st.gradeBadgeRare : {}) }}>
                PSA {card.grade}
                {card.gradeDescription && (
                  <span style={st.gradeDesc}> — {card.gradeDescription}</span>
                )}
              </div>

              {rare && <div style={st.rareBanner}>✦ Rare — Low Population</div>}
            </div>

            {/* ── Right: details ── */}
            <div style={st.detailCol}>
              <h2 style={st.playerName}>{card.playerName ?? "Unknown Player"}</h2>
              <p style={st.subLine}>
                {[card.year, card.brand, card.sport].filter(Boolean).join(" · ")}
              </p>

              <div style={st.divider} />

              <table style={st.table}>
                <tbody>
                  {[
                    ["Card #",  card.cardNumber],
                    ["Cert #",  card.certNumber],
                    ["Year",    card.year],
                    ["Brand",   card.brand],
                    ["Sport",   card.sport],
                    ["Variety", card.variety],
                  ].map(([label, val]) =>
                    val ? (
                      <tr key={label}>
                        <td style={st.tdLabel}>{label}</td>
                        <td style={st.tdVal}>{val}</td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>

              {(card.psaPopulation !== null || card.psaPopulationHigher !== null) && (
                <>
                  <div style={st.sectionHead}>PSA Population</div>
                  <div style={{ ...st.popBlock, ...(rare ? st.popBlockRare : {}) }}>
                    {card.psaPopulation !== null && (
                      <PopStat label="At this grade" value={card.psaPopulation.toLocaleString()} highlight={rare} />
                    )}
                    {card.psaPopulationHigher !== null && (
                      <PopStat
                        label="Graded higher"
                        value={card.psaPopulationHigher.toLocaleString()}
                        highlight={card.psaPopulationHigher === 0}
                        highlightColor="#059669"
                      />
                    )}
                  </div>
                </>
              )}

              {displayValue !== null && (
                <>
                  <div style={st.sectionHead}>Market Value</div>
                  <div style={st.priceBlock}>
                    <div style={st.mainPrice}>{fmt(displayValue)}</div>
                    <div style={st.priceDetails}>
                      {card.avgSalePrice  && <span>Avg {fmt(card.avgSalePrice)}</span>}
                      {card.lastSalePrice && <><span style={st.dot}>·</span><span>Last {fmt(card.lastSalePrice)}</span></>}
                      {card.numSales      && <><span style={st.dot}>·</span><span>{card.numSales} sales</span></>}
                    </div>
                    {card.priceSource && (
                      <span style={{ ...st.sourceBadge, ...sourceBadgeStyle(card.priceSource) }}>
                        {badgeLabel(card.priceSource)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {zoomSrc && <ZoomView src={zoomSrc.src} alt={zoomSrc.alt} onClose={() => setZoomSrc(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function PopStat({ label, value, highlight, highlightColor = "#d97706" }) {
  return (
    <div style={st.popStat}>
      <span style={st.popStatLabel}>{label}</span>
      <span style={{ ...st.popStatValue, ...(highlight ? { color: highlightColor, fontWeight: 700 } : {}) }}>
        {value}
      </span>
    </div>
  );
}

function badgeLabel(s) { return s === "manual" ? "manual" : s === "ebay" ? "eBay" : "est."; }
function sourceBadgeStyle(s) {
  if (s === "manual") return { background: "#ede9fe", color: "#5b21b6" };
  if (s === "ebay")   return { background: "#fef3c7", color: "#92400e" };
  return { background: "#f3f4f6", color: "#9ca3af" };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const st = {
  backdrop: {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.72)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "1rem", backdropFilter: "blur(3px)",
  },
  modal: {
    position: "relative", background: "#fff", borderRadius: 16,
    width: "100%", maxWidth: 820, maxHeight: "90vh", overflowY: "auto",
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  },
  modalRare: { boxShadow: "0 24px 60px rgba(0,0,0,0.35), 0 0 0 2px #f59e0b" },
  closeBtn: {
    position: "absolute", top: 14, right: 14, zIndex: 1,
    background: "#f3f4f6", border: "none", borderRadius: "50%",
    width: 32, height: 32, fontSize: "0.85rem",
    cursor: "pointer", color: "#6b7280",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  body: { display: "flex", gap: "2rem", padding: "2rem", flexWrap: "wrap" },

  imageCol: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: "0.75rem", flexShrink: 0,
  },

  // Spotlight: canvas fills it via position:absolute, gradient is the background
  spotlight: {
    width: 284, height: 392,
    borderRadius: 18, overflow: "hidden",
    background: "radial-gradient(ellipse at 50% 50%, #ffffff 0%, #f4f5f7 50%, #e4e7ed 100%)",
    position: "relative",
    cursor: "pointer",
    boxShadow: "inset 0 2px 16px rgba(0,0,0,0.06)",
  },
  canvas: {
    position: "absolute", inset: 0,
    width: "100%", height: "100%",
    display: "block",
  },
  loadingOverlay: {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    pointerEvents: "none",
  },
  loadingDot: {
    color: "#d1d5db", fontSize: "2rem",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  hoverHint: {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    pointerEvents: "none",
  },
  hoverHintText: {
    background: "rgba(0,0,0,0.52)", color: "#fff",
    fontSize: "0.8rem", fontWeight: 600,
    padding: "0.4rem 0.9rem", borderRadius: 20,
    backdropFilter: "blur(4px)",
  },

  gradeBadge: {
    background: "#fef3c7", color: "#92400e",
    fontWeight: 700, fontSize: "0.9rem",
    padding: "0.4rem 0.9rem", borderRadius: 20,
  },
  gradeBadgeRare: {
    background: "linear-gradient(135deg,#fef3c7,#fde68a)",
    boxShadow: "0 2px 8px rgba(217,119,6,0.25)",
  },
  gradeDesc: { fontWeight: 400, fontSize: "0.8rem" },
  rareBanner: {
    background: "linear-gradient(135deg,#f59e0b,#d97706)",
    color: "#fff", fontWeight: 700,
    fontSize: "0.78rem", letterSpacing: "0.04em",
    padding: "0.35rem 0.9rem", borderRadius: 20,
    boxShadow: "0 2px 8px rgba(217,119,6,0.35)",
  },

  detailCol: { flex: 1, minWidth: 240 },
  playerName: { fontSize: "1.5rem", fontWeight: 800, margin: 0, lineHeight: 1.2 },
  subLine: { color: "#6b7280", fontSize: "0.88rem", marginTop: "0.3rem" },
  divider: { borderTop: "1px solid #f3f4f6", margin: "1rem 0" },
  table: { width: "100%", borderCollapse: "collapse", marginBottom: "1.25rem" },
  tdLabel: {
    color: "#9ca3af", fontSize: "0.78rem", fontWeight: 500,
    padding: "0.3rem 0.75rem 0.3rem 0", width: 90, verticalAlign: "top",
  },
  tdVal: { fontSize: "0.88rem", color: "#111827", padding: "0.3rem 0" },
  sectionHead: {
    fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: "#9ca3af", marginBottom: "0.5rem",
  },
  popBlock: {
    background: "#f9fafb", borderRadius: 8,
    padding: "0.75rem", marginBottom: "1.25rem",
    display: "flex", gap: "1.5rem",
  },
  popBlockRare: { background: "#fffbeb", border: "1px solid #fde68a" },
  popStat: { display: "flex", flexDirection: "column", gap: "0.15rem" },
  popStatLabel: { fontSize: "0.72rem", color: "#9ca3af" },
  popStatValue: { fontSize: "1.1rem", fontWeight: 700, color: "#111827" },
  priceBlock: { marginBottom: "1rem" },
  mainPrice: { fontSize: "1.8rem", fontWeight: 800, color: "#111827", lineHeight: 1 },
  priceDetails: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.3rem",
    fontSize: "0.8rem", color: "#6b7280", marginTop: "0.35rem",
  },
  dot: { color: "#d1d5db" },
  sourceBadge: {
    display: "inline-block", marginTop: "0.5rem",
    fontSize: "0.65rem", fontWeight: 600,
    padding: "0.15rem 0.45rem", borderRadius: 3,
    textTransform: "uppercase", letterSpacing: "0.04em",
  },
};
