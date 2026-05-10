// Static performance contracts for PortfolioPage. These don't render
// React — they read the source file as text and assert structural
// invariants that prior perf passes established. The intent is to fail
// CI loudly if a refactor accidentally:
//   • drops React.memo from CardTile (every parent state change re-renders the whole grid)
//   • un-memoizes the visibleCards / summary derivations (O(n) work per render)
//   • inlines a closure into the cards-grid map (defeats CardTile.memo)
//
// Tests are deliberately regex-based and tolerant of formatting changes.
// If a refactor needs to relax one of these, update both the code and
// this test together — and document why in the commit.
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const portfolioSrc = readFileSync(
  resolve(__dirname, "../src/pages/PortfolioPage.jsx"),
  "utf8"
);

describe("PortfolioPage performance contracts", () => {
  test("CardTile is wrapped in React.memo", () => {
    expect(portfolioSrc).toMatch(/const\s+CardTile\s*=\s*memo\(/);
  });

  test("CardListRow is wrapped in React.memo", () => {
    expect(portfolioSrc).toMatch(/const\s+CardListRow\s*=\s*memo\(/);
  });

  test("visibleCards is wrapped in useMemo", () => {
    expect(portfolioSrc).toMatch(/const\s+visibleCards\s*=\s*useMemo/);
  });

  test("summarizePortfolio result is wrapped in useMemo", () => {
    expect(portfolioSrc).toMatch(/const\s+summary\s*=\s*useMemo/);
  });

  // Regression guard against the exact pattern that caused the prior
  // perf bug: inline arrow closures passed as props inside the
  // cards-grid map. The closure-in-prop pattern matches `={...=>`
  // anywhere between the map opener and its closing `))}`.
  test("no inline arrow functions in props inside the cards-grid map", () => {
    // CardGrid extracted the map; check both the wrapper component
    // and the parent call-site for closures-in-props.
    const cardGridStart = portfolioSrc.indexOf("function CardGridImpl");
    expect(cardGridStart, "CardGridImpl must exist").toBeGreaterThan(-1);
    const cardGridEnd = portfolioSrc.indexOf(
      "const CardGrid = memo(CardGridImpl)",
      cardGridStart
    );
    expect(cardGridEnd, "CardGrid memo wrapper must follow Impl").toBeGreaterThan(cardGridStart);
    const block = portfolioSrc.slice(cardGridStart, cardGridEnd);

    // Match `={...=>...}` — a JSX prop value that is a fresh arrow.
    // The map iteration arrow `(card, idx) =>` doesn't start with `={`,
    // so it's correctly excluded.
    const inlineClosures = block.match(/=\{[^}]*=>/g);
    expect(inlineClosures, `Found inline arrow(s): ${JSON.stringify(inlineClosures)}`).toBeNull();
  });
});
