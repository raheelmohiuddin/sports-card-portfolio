const {
  isValidId,
  isValidCertNumber,
  isValidPrice,
  isValidCount,
  isHttpsUrl,
  sanitize,
} = require("../functions/_validate");

describe("isValidId", () => {
  test("accepts UUID v4", () => {
    expect(isValidId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  test("accepts positive integer string", () => {
    expect(isValidId("42")).toBe(true);
  });

  test("rejects null and undefined", () => {
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });

  test("rejects negative integers and zero", () => {
    expect(isValidId("0")).toBe(false);
    expect(isValidId("-1")).toBe(false);
  });

  test("rejects malformed UUIDs", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
    expect(isValidId("550e8400-e29b-41d4-a716")).toBe(false);
  });

  test("rejects floats and SQL injection attempts", () => {
    expect(isValidId("1.5")).toBe(false);
    expect(isValidId("1; DROP TABLE cards;")).toBe(false);
  });
});

describe("isValidCertNumber", () => {
  test("accepts numeric PSA cert", () => {
    expect(isValidCertNumber("93794097")).toBe(true);
  });

  test("accepts alphanumeric BGS cert with leading zeros", () => {
    expect(isValidCertNumber("0015739697")).toBe(true);
  });

  test("trims surrounding whitespace before validating", () => {
    expect(isValidCertNumber("  12345  ")).toBe(true);
  });

  test("rejects non-strings, empty, and over 30 chars", () => {
    expect(isValidCertNumber(null)).toBe(false);
    expect(isValidCertNumber(12345)).toBe(false);
    expect(isValidCertNumber("")).toBe(false);
    expect(isValidCertNumber("a".repeat(31))).toBe(false);
  });

  test("rejects special characters", () => {
    expect(isValidCertNumber("123-456")).toBe(false);
    expect(isValidCertNumber("123 456")).toBe(false);
    expect(isValidCertNumber("'; DROP")).toBe(false);
  });
});

describe("isValidPrice", () => {
  test("accepts zero and positive numbers", () => {
    expect(isValidPrice(0)).toBe(true);
    expect(isValidPrice(42.99)).toBe(true);
    expect(isValidPrice("100.50")).toBe(true);
  });

  test("rejects negatives", () => {
    expect(isValidPrice(-1)).toBe(false);
    expect(isValidPrice("-0.01")).toBe(false);
  });

  test("rejects NaN, Infinity, non-numeric strings", () => {
    expect(isValidPrice(NaN)).toBe(false);
    expect(isValidPrice(Infinity)).toBe(false);
    expect(isValidPrice("abc")).toBe(false);
  });

  test("rejects values >= 10 million (sanity ceiling)", () => {
    expect(isValidPrice(10_000_000)).toBe(false);
    expect(isValidPrice(99_999_999)).toBe(false);
    expect(isValidPrice(9_999_999.99)).toBe(true);
  });
});

describe("isValidCount", () => {
  test("accepts non-negative integers and integer strings", () => {
    expect(isValidCount(0)).toBe(true);
    expect(isValidCount(5)).toBe(true);
    expect(isValidCount("42")).toBe(true);
  });

  test("treats null/undefined as absent (allowed)", () => {
    expect(isValidCount(null)).toBe(true);
    expect(isValidCount(undefined)).toBe(true);
  });

  test("rejects negatives and non-numeric", () => {
    expect(isValidCount(-1)).toBe(false);
    expect(isValidCount("abc")).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  test("accepts valid https URLs", () => {
    expect(isHttpsUrl("https://example.com")).toBe(true);
    expect(isHttpsUrl("https://cdn.bubble.io/foo.jpg")).toBe(true);
  });

  test("rejects http (insecure), ftp, javascript:, data:", () => {
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("ftp://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("data:text/html,<script>")).toBe(false);
  });

  test("rejects garbage and empty input", () => {
    expect(isHttpsUrl("not-a-url")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });
});

describe("sanitize", () => {
  test("trims and truncates to maxLen", () => {
    expect(sanitize("  hello  ", 100)).toBe("hello");
    expect(sanitize("a".repeat(50), 10)).toHaveLength(10);
  });

  test("returns null for null/undefined", () => {
    expect(sanitize(null, 10)).toBeNull();
    expect(sanitize(undefined, 10)).toBeNull();
  });

  test("coerces non-strings to string", () => {
    expect(sanitize(42, 10)).toBe("42");
  });
});
