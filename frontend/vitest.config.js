import { defineConfig } from "vitest/config";

// Pure-utility tests only — no JSX, no DOM. Keeps the runner fast and
// the dependency surface small (no jsdom or @testing-library needed).
// If/when we add component-render tests, switch `environment` to
// "jsdom" and pull in @testing-library/react.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/utils/__tests__/**/*.test.js",
      "__tests__/**/*.test.js",
    ],
  },
});
