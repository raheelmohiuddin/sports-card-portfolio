// Server-side filter that strips CardHedger's generic category
// placeholders so they never get persisted as cardhedger_image_url
// (write-time guard in pricing.js / lookup-cert.js) and never get
// served as a card image (read-time guard in get-cards/get-card).
//
// Two patterns to recognise:
//   1. URLs that touch the appforest_uf S3 path (CardHedger's
//      direct-S3 fallback URL — real card photos go through the
//      cdn.bubble.io CDN host instead).
//   2. Filenames matching <digits>-<Sport>.jpg / .jpeg — observed
//      forms include "05-Football.jpg", "05-Basketball.jpg", etc.,
//      which are sport-bucket placeholders.
//
// Anything that matches is treated as if no image were available.

function isPlaceholderImage(url) {
  if (!url) return false; // null/empty handled by caller — not a "placeholder"
  const s = String(url);
  if (s.includes("appforest_uf")) return true;
  // Path segment ending in "<digits>-<Word>.jpg|.jpeg"
  if (/\/\d{1,3}-[A-Za-z]+\.jpe?g(\?.*)?$/i.test(s)) return true;
  return false;
}

// Returns the URL when usable, or null when missing / blank / placeholder.
function safeImageUrl(url) {
  if (!url) return null;
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return isPlaceholderImage(trimmed) ? null : trimmed;
}

module.exports = { isPlaceholderImage, safeImageUrl };
