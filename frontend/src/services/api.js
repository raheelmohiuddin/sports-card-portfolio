import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function lookupPsaCert(certNumber) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/psa/${certNumber}`, { headers });
  if (!res.ok) throw new Error(`PSA lookup failed: ${res.status}`);
  return res.json();
}

// Throws a rich error so callers can branch on status (e.g. 409 duplicates).
async function readError(res) {
  let data = null;
  try { data = await res.json(); } catch {}
  const err = new Error(data?.error ?? `Request failed: ${res.status}`);
  err.status = res.status;
  err.data = data;
  return err;
}

export async function addCard(cardData) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards`, {
    method: "POST",
    headers,
    body: JSON.stringify(cardData),
  });
  if (!res.ok) throw await readError(res);
  return res.json(); // { id, frontUploadUrl, backUploadUrl }
}

export async function getCards() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards`, { headers });
  if (!res.ok) throw new Error(`Get cards failed: ${res.status}`);
  return res.json();
}

// Fetches a single card with freshly-generated signed S3 URLs.
// cache: "no-store" bypasses the browser HTTP cache so the signed URLs
// are never stale — each call gets a new pre-signed URL with a new signature,
// which also means the URL string itself is different from any cached non-CORS entry.
export async function getCard(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Get card failed: ${res.status}`);
  return res.json();
}

export async function deleteCard(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Delete card failed: ${res.status}`);
}

export async function getPortfolioValue() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/portfolio/value`, { headers });
  if (!res.ok) throw new Error(`Portfolio value failed: ${res.status}`);
  return res.json();
}

export async function getPortfolioHistory() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/portfolio/history`, { headers });
  if (!res.ok) throw new Error(`Portfolio history failed: ${res.status}`);
  return res.json();
}

export async function getCardSales(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}/sales`, { headers });
  if (!res.ok) throw new Error(`Card sales failed: ${res.status}`);
  return res.json();
}

// Returns { uploadUrl, key, contentType } — client uploads directly to S3,
// then writes the returned `key` to Cognito's `picture` attribute.
export async function getAvatarUploadUrl(contentType) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/profile/avatar-upload-url`, {
    method: "POST",
    headers,
    body: JSON.stringify({ contentType }),
  });
  if (!res.ok) throw new Error(`Avatar upload URL failed: ${res.status}`);
  return res.json();
}

// Fresh signed GET URL for displaying the user's avatar. Server validates
// that the key belongs to the caller (avatars/{their-sub}/...).
export async function getAvatarViewUrl(key) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/profile/avatar-view-url?key=${encodeURIComponent(key)}`, {
    headers,
  });
  if (!res.ok) throw new Error(`Avatar view URL failed: ${res.status}`);
  return res.json();
}

// Image moderation gate — call before requesting an S3 upload URL.
// Body: { image: base64-string, contentType: "image/jpeg" } and returns
// { allowed: bool, reason: string, unverified?: bool }. Server-side
// fail-open semantics: infrastructure errors return allowed=true with
// unverified=true rather than block the user.
export async function moderateImage({ image, contentType }) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/moderate-image`, {
    method: "POST",
    headers,
    body: JSON.stringify({ image, contentType }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Analyze a card's front image via Claude vision and return the border edge color.
// Returns { edgeColor: "#hex", texture: "white|cream|colored" }.
// Falls back to { edgeColor: "#f2f0eb", texture: "white" } on any failure.
export async function generateEdgeTexture(imageUrl) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/edge-texture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) throw new Error(`Edge texture failed: ${res.status}`);
  return res.json();
}

// Update editable fields on a card. Currently supports myCost; pass null to clear.
export async function updateCard(id, patch) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update card failed: ${res.status}`);
  return res.json();
}

// Set or clear a manual price override for a card.
// Pass manualPrice as a number to set, or null to clear (reverts to eBay/mock).
export async function updateCardPrice(id, manualPrice) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}/price`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ manualPrice }),
  });
  if (!res.ok) throw new Error(`Update price failed: ${res.status}`);
  return res.json();
}

// ─── Consignments (collector) ─────────────────────────────────────────
export async function createConsignment({ cardId, type, askingPrice, notes }) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/consignments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ cardId, type, askingPrice, notes }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// ─── Admin endpoints ──────────────────────────────────────────────────
export async function getAdminStats() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/stats`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function getAdminCards() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/cards`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function getAdminConsignments() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/consignments`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// ─── Card shows ───────────────────────────────────────────────────────
// states is an array of 2-letter codes (e.g. ["PA","NY"]). Empty array
// or missing → no state filter. centerLat + centerLng + radiusMiles
// activate the proximity (Haversine) filter — all three must be
// provided together.
export async function getShows({ states, from, to, q, centerLat, centerLng, radiusMiles } = {}) {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (states && states.length) params.set("state", states.join(","));
  if (from)  params.set("from",  from);
  if (to)    params.set("to",    to);
  if (q)     params.set("q",     q);
  if (Number.isFinite(centerLat) && Number.isFinite(centerLng) && Number.isFinite(radiusMiles)) {
    params.set("centerLat",   String(centerLat));
    params.set("centerLng",   String(centerLng));
    params.set("radiusMiles", String(radiusMiles));
  }
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/shows${qs ? `?${qs}` : ""}`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function markAttending(showId, notes) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/shows/${showId}/attending`, {
    method: "POST",
    headers,
    body: JSON.stringify(notes != null ? { notes } : {}),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function unmarkAttending(showId) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/shows/${showId}/attending`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Single-card fetchers used by the admin sidebar (CardModal opened from
// /admin/consignments). Same response shape as getCard / getCardSales —
// CardModal's `loaders` prop swaps these in for cards the admin doesn't own.
export async function getAdminCard(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/cards/${id}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function getAdminCardSales(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/cards/${id}/sales`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function updateAdminConsignment(id, patch) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/consignments/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Upload front and/or back images directly to S3 using pre-signed URLs.
// Skips a side if no file is provided for it.
export async function uploadCardImages({ frontUploadUrl, frontFile, backUploadUrl, backFile }) {
  const uploads = [];
  if (frontFile && frontUploadUrl) {
    uploads.push(
      fetch(frontUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: frontFile,
      }).then((r) => { if (!r.ok) throw new Error("Front image upload failed"); })
    );
  }
  if (backFile && backUploadUrl) {
    uploads.push(
      fetch(backUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: backFile,
      }).then((r) => { if (!r.ok) throw new Error("Back image upload failed"); })
    );
  }
  await Promise.all(uploads);
}
