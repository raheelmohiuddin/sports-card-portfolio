// Input validation helpers — used by all Lambda handlers before touching the DB.
// Parameterised pg queries already prevent SQL injection; these add a second
// layer by rejecting malformed inputs before they reach the query layer at all.

// PostgreSQL serial/bigserial IDs: positive integer, no leading zeros.
function isValidId(val) {
  if (val == null) return false;
  const s = String(val).trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && String(n) === s;
}

// PSA cert numbers: alphanumeric, 1–30 chars.
function isValidCertNumber(val) {
  if (typeof val !== "string") return false;
  return /^[a-zA-Z0-9]{1,30}$/.test(val.trim());
}

// Trim and truncate a string field; returns null when the input is null/undefined.
function sanitize(val, maxLen = 500) {
  if (val == null) return null;
  return String(val).trim().slice(0, maxLen);
}

// Must be a valid absolute HTTPS URL.
function isHttpsUrl(val) {
  if (!val || typeof val !== "string") return false;
  try {
    return new URL(val).protocol === "https:";
  } catch {
    return false;
  }
}

// Non-negative finite number within a sane ceiling for a card price.
function isValidPrice(val) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 && n < 10_000_000;
}

// Non-negative integer (accepts numeric strings); null/undefined are allowed (→ treated as absent).
function isValidCount(val) {
  if (val == null) return true;
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) && n >= 0;
}

module.exports = { isValidId, isValidCertNumber, sanitize, isHttpsUrl, isValidPrice, isValidCount };
