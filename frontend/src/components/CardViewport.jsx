import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { generateEdgeTexture, getCard } from "../services/api.js";

// ─── Texture loader ─────────────────────────────────────────────────────
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
      console.warn(`[CardViewport] Texture fetch failed: HTTP ${res.status} — ${url}`);
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
          console.warn("[CardViewport] Three.js texture decode failed:", err);
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        }
      );
    });
  } catch (err) {
    console.warn("[CardViewport] Texture load error:", err.message, "—", url);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
}

// ─── Geometry constants ────────────────────────────────────────────────
// BoxGeometry face indices: 0=+X(R), 1=-X(L), 2=+Y(T), 3=-Y(B), 4=+Z(Front), 5=-Z(Back)
const CARD_W = 2.5;
const CARD_H = 3.5;
const CARD_D = 0.04; // thick enough to see edges clearly

// ─── Edge colour cache + fetcher ──────────────────────────────────────
// Module-level cache keyed by card ID — persists across modal open/close
// so the AI vision call only happens once per card per browser session.
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
  canvas.width  = W;
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

// ─── Three.js render hook ─────────────────────────────────────────────
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

      // Renderer — transparent background so the radial gradient shows through
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const scene = new THREE.Scene();

      // Camera: FOV chosen so card fills ~80% of viewport height with breathing room
      const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
      camera.position.z = 6;

      // Lighting — ambient fill + directional key + soft back fill
      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(3, 5, 6);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xdde8f0, 0.35);
      fillLight.position.set(-4, -3, -5);
      scene.add(fillLight);

      // Load textures + analyse edge colour in parallel — edge analysis adds
      // zero wall-clock time beyond what texture loading already costs.
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
        edgeMat,           // 0 Right
        edgeMat,           // 1 Left
        edgeMat,           // 2 Top
        edgeMat,           // 3 Bottom
        faceMat(frontTex), // 4 Front (+Z)
        faceMat(backTex),  // 5 Back  (-Z)
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

// ─── Component ────────────────────────────────────────────────────────
export default function CardViewport({ card, onZoom }) {
  const canvasRef = useRef(null);
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        style={st.canvas}
        title={hovered ? "Click to zoom" : undefined}
      />

      {loading && (
        <div style={st.loadingOverlay}>
          <span style={st.loadingDot}>●</span>
        </div>
      )}

      {hovered && !loading && (
        <div style={st.hoverHint}>
          <span style={st.hoverHintText}>🔍 Click to zoom</span>
        </div>
      )}
    </div>
  );
}

const st = {
  // Light radial gradient bg keeps the card readable against the dark sidebar.
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
};
