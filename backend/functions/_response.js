// Shared HTTP response builder — attaches security headers to every Lambda response.
// CloudFront also enforces these via ResponseHeadersPolicy (override:true),
// but adding them here ensures they're present when testing API Gateway directly.
const SEC_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

function json(statusCode, body) {
  return { statusCode, headers: SEC_HEADERS, body: JSON.stringify(body) };
}

function noContent() {
  return {
    statusCode: 204,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Cache-Control": "no-store",
    },
    body: "",
  };
}

module.exports = { json, noContent };
