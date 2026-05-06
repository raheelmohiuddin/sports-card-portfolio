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

export async function addCard(cardData) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards`, {
    method: "POST",
    headers,
    body: JSON.stringify(cardData),
  });
  if (!res.ok) throw new Error(`Add card failed: ${res.status}`);
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
