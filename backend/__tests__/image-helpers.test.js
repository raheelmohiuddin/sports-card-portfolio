const { safeImageUrl, isPlaceholderImage } = require("../functions/_image-helpers");

describe("isPlaceholderImage", () => {
  test("flags appforest_uf S3 fallback URLs", () => {
    expect(isPlaceholderImage("https://s3.amazonaws.com/appforest_uf/foo.jpg")).toBe(true);
  });

  test("flags <digits>-<Sport>.jpg pattern (sport-bucket placeholders)", () => {
    expect(isPlaceholderImage("https://cdn.example.com/05-Football.jpg")).toBe(true);
    expect(isPlaceholderImage("https://cdn.example.com/path/12-Basketball.jpeg")).toBe(true);
    expect(isPlaceholderImage("https://cdn.example.com/3-Soccer.jpg?v=2")).toBe(true);
  });

  test("does NOT flag real card image URLs", () => {
    expect(isPlaceholderImage("https://cdn.bubble.io/abc123.jpg")).toBe(false);
    expect(isPlaceholderImage("https://psa.com/cert/93794097-front.jpg")).toBe(false);
  });

  test("returns false for null/empty (caller handles those)", () => {
    expect(isPlaceholderImage(null)).toBe(false);
    expect(isPlaceholderImage("")).toBe(false);
  });
});

describe("safeImageUrl", () => {
  test("returns the url when it's a real image", () => {
    expect(safeImageUrl("https://cdn.bubble.io/real.jpg")).toBe("https://cdn.bubble.io/real.jpg");
  });

  test("returns null for placeholder patterns", () => {
    expect(safeImageUrl("https://x/05-Football.jpg")).toBeNull();
    expect(safeImageUrl("https://s3/appforest_uf/x.jpg")).toBeNull();
  });

  test("returns null for null/empty/whitespace/non-string", () => {
    expect(safeImageUrl(null)).toBeNull();
    expect(safeImageUrl(undefined)).toBeNull();
    expect(safeImageUrl("")).toBeNull();
    expect(safeImageUrl("   ")).toBeNull();
    expect(safeImageUrl(42)).toBeNull();
  });

  test("trims surrounding whitespace before checking", () => {
    expect(safeImageUrl("  https://cdn.bubble.io/x.jpg  ")).toBe("https://cdn.bubble.io/x.jpg");
  });
});
