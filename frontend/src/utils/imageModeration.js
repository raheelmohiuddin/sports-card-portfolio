// Client-side moderation orchestrator for the Add Card flow.
//
//   moderateFile(file)
//     1. SHA-256 the original file bytes (so caching survives canvas
//        re-encoding).
//     2. localStorage cache hit → return immediately (same image
//        already cleared, no need to re-spend Claude tokens).
//     3. Canvas-downsize to ≤1024px and re-encode JPEG @0.85 — keeps
//        the API Gateway payload comfortably under the 6MB limit
//        regardless of source image size, and Claude vision needs
//        nowhere near full resolution to assess content.
//     4. POST to /cards/moderate-image, cache result, return it.
//
// Returns { allowed: boolean, reason: string, unverified?: boolean }.
// Throws only on network/HTTP errors — server-side moderation errors
// come back as allowed=true with unverified=true (fail-open).

import { moderateImage } from "../services/api.js";

const CACHE_KEY = "scp.imageModerationCache";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const MAX_DIM = 1024;
const JPEG_QUALITY = 0.85;

// SHA-256 of the file's bytes, hex-encoded. Stable across re-encodes
// because we hash the ORIGINAL file, not the downsized version.
async function fileHash(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); }
  catch { return {}; }
}
function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}
function cacheGet(hash) {
  const c = readCache();
  const hit = c[hash];
  if (!hit) return null;
  if (Date.now() - (hit.t ?? 0) > CACHE_TTL_MS) return null;
  return { allowed: hit.allowed, reason: hit.reason ?? "", unverified: hit.unverified };
}
function cachePut(hash, result) {
  const c = readCache();
  c[hash] = { ...result, t: Date.now() };
  writeCache(c);
}

// Downsize via canvas + re-encode as JPEG. Returns just the base64 body
// (no "data:" prefix). Always picks JPEG so the API contract is stable
// regardless of the source format (PNG / WebP / etc.).
async function downsizeToBase64(file) {
  const objUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = objUrl;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width  * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return dataUrl.split(",")[1];
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export async function moderateFile(file) {
  if (!file || !file.type?.startsWith("image/")) {
    return { allowed: false, reason: "not-an-image" };
  }

  const hash = await fileHash(file);
  const cached = cacheGet(hash);
  if (cached) return cached;

  const image = await downsizeToBase64(file);
  const result = await moderateImage({ image, contentType: "image/jpeg" });

  cachePut(hash, result);
  return result;
}
