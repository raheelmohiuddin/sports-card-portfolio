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
