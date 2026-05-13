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

// Generic cert lookup that branches on grader. PSA stays on the
// existing /psa/{cert} route (PSA's own API). BGS / SGC go to the new
// /cards/lookup-cert route which reshapes CardHedger's prices-by-cert
// response to the same contract — letting the AddCardPage share its
// state machine across all three graders.
export async function lookupCert(certNumber, grader) {
  if (grader === "PSA") {
    return lookupPsaCert(certNumber);
  }
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/lookup-cert`, {
    method: "POST", headers,
    body: JSON.stringify({ certNumber, grader }),
  });
  if (!res.ok) throw await readError(res);
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

// Returns CardHedger pricing for an arbitrary cert without persisting
// it to the user's portfolio. Used by the Trade Builder to preview the
// estimated value of cards being traded for.
// Returns: { available: true, avgSalePrice, lastSalePrice, ... } or
//          { available: false, reason }
export async function previewPricing(card) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/pricing/preview`, {
    method: "POST", headers,
    body: JSON.stringify({
      certNumber: card.certNumber,
      playerName: card.playerName,
      year:       card.year,
      brand:      card.brand,
      cardNumber: card.cardNumber,
      grade:      card.grade,
      // Send both: backend prefers category and falls back to sport.
      // Held during the transition so cards added pre-rollout still
      // carry their legacy sport value through preview pricing.
      sport:      card.sport,
      category:   card.category ?? null,
    }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Submits a trade for atomic execution. Server marks given cards as
// 'traded', inserts received cards (NULL my_cost), creates a pending
// trade row, and returns { tradeId, receivedCards: [{ id, certNumber }] }.
// Cost basis is allocated in a follow-up call to confirmTradeCost.
export async function executeTrade(payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/trades/execute`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// AI trade analysis — sends the in-progress trade payload, server enriches
// the given side from the DB (raw_comps, cost basis, pop), then calls
// Claude Sonnet 4.6 with structured tool_use to return a verdict.
// Returns the analysis object: { summary, valueAnalysis, shortTermOutlook,
// longTermOutlook, populationAnalysis, salesVelocity, riskAssessment,
// verdict, confidence, keyReasons }.
export async function analyzeTrade(payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/trades/analyze`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Returns the user's executed trade history. Each row carries the
// pre-snapshotted given + received card metadata from trade_cards plus
// the trade-time net P&L. Used by the TradeDesk page's "Past Trades"
// section.
export async function listTrades() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/trades`, { headers });
  if (!res.ok) throw new Error(`List trades failed: ${res.status}`);
  return res.json();
}

// Atomic rollback of a pending trade. Used by the Trade Builder's Back
// button on the allocation screen — restores given cards to active,
// deletes the inserted received cards, and removes the trade row.
// Server-side gated on trades.status='pending'.
export async function cancelTrade(tradeId) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/trades/cancel`, {
    method: "POST", headers, body: JSON.stringify({ tradeId }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Finalizes a pending trade by allocating cost basis to each received
// card. Body: { tradeId, allocations: [{ certNumber, cost }] }. Server
// updates each card.my_cost AND trade_cards.allocated_cost, then marks
// the trade as 'executed'.
export async function confirmTradeCost(payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/trades/confirm-cost`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Triggers a server-side CardHedger refresh. Two modes:
//   • no payload → walks all cards, refreshes those past the 24h
//                  staleness window (PortfolioPage SWR mount)
//   • { cardIds: [...] } → scopes the refresh to those cards AND
//                          bypasses the staleness gate. Used by the
//                          Trade Builder right after confirm-cost so
//                          received cards get pricing + image URLs
//                          populated immediately.
// Returns { refreshed, skipped, failed }.
export async function refreshPortfolio(payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/portfolio/refresh`, {
    method: "POST",
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) throw new Error(`Portfolio refresh failed: ${res.status}`);
  return res.json();
}

export async function getCardSales(id, grade, { signal } = {}) {
  const headers = await authHeaders();
  const url = grade
    ? `${API_BASE}/cards/${id}/sales?grade=${encodeURIComponent(grade)}`
    : `${API_BASE}/cards/${id}/sales`;
  const res = await fetch(url, { headers, signal });
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
export async function createConsignment({ cardId, type, askingPrice, auctionPlatform, notes }) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/consignments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ cardId, type, askingPrice, auctionPlatform, notes }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// ─── Self-sold (collector marks a card sold themselves) ───────────────
// PATCH /cards/{id}/mark-sold — distinct from consignments: no platform
// workflow, no fee, no sellers_net. Payload shape:
//   { soldPrice, soldAt, venueType: 'show'|'auction'|'other',
//     showId? (uuid), auctionHouse? (text), otherText? (text) }
// Exactly one of showId / auctionHouse / otherText is populated, matching
// venueType. Returns the updated sold-state fields.
export async function markCardSold(cardId, payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${cardId}/mark-sold`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// ─── Potential Acquisitions ───────────────────────────────────────────
// CRUD + move-to-collection for the PA bucket. Per
// .agents/potential-acquisitions-plan.md §4.
//
// Note: addPotentialAcquisition response carries frontUploadUrl /
// backUploadUrl (same as addCard); the caller uses uploadCardImages
// to PUT to those pre-signed S3 URLs when the user supplied an image.
export async function getPotentialAcquisitions() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions`, { headers });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function addPotentialAcquisition(payload) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function deletePotentialAcquisition(id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Transactional transfer: copies PA row into cards (carrying wanted_since
// from PA's added_at per OQ-2) and DELETEs the PA. Body fields are
// optional — collector may not know one or both at acquisition time.
export async function movePotentialAcquisitionToCollection(id, { myCost, sellTargetPrice } = {}) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/potential-acquisitions/${id}/move`, {
    method: "POST",
    headers,
    body: JSON.stringify({ myCost, sellTargetPrice }),
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
// provided together. attendedOnly=true switches the endpoint to history
// mode (INNER JOIN to user_shows + drop date floor) so callers can list
// the user's past attended shows — see MarkSoldBlock.
export async function getShows({ states, from, to, q, centerLat, centerLng, radiusMiles, attendedOnly } = {}) {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (states && states.length) params.set("state", states.join(","));
  if (from)  params.set("from",  from);
  if (to)    params.set("to",    to);
  if (q)     params.set("q",     q);
  if (attendedOnly) params.set("attendedOnly", "true");
  // Center coords drive the sort (nearest-first) on the server even
  // when no radius cutoff is set ("Any" option). Radius is only sent
  // when it's a positive number — the absence is the "any" signal.
  if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
    params.set("centerLat", String(centerLat));
    params.set("centerLng", String(centerLng));
    if (Number.isFinite(radiusMiles) && radiusMiles > 0) {
      params.set("radiusMiles", String(radiusMiles));
    }
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

// Travel time from a US zip to a (city, state) destination. Returns
// { mode: "drive"|"fly", durationMinutes, distanceMiles }. Caller is
// responsible for caching — the My Shows page maintains a session-scoped
// Map keyed by `${zip}|${city}|${state}` to avoid duplicate requests.
export async function getTravelTime({ originZip, destCity, destState, destCountry }) {
  const headers = await authHeaders();
  const params  = new URLSearchParams();
  params.set("originZip", originZip);
  params.set("destCity",  destCity);
  params.set("destState", destState);
  if (destCountry) params.set("destCountry", destCountry);
  const res = await fetch(`${API_BASE}/travel-time?${params.toString()}`, { headers });
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

export async function getAdminCardSales(id, grade) {
  const headers = await authHeaders();
  const url = grade
    ? `${API_BASE}/admin/cards/${id}/sales?grade=${encodeURIComponent(grade)}`
    : `${API_BASE}/admin/cards/${id}/sales`;
  const res = await fetch(url, { headers });
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
