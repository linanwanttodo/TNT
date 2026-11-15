import { defineConfig } from "vitest/config";

/**
 * Runs only the live tests, which the default config excludes because they
 * spend real tokens. Kept as a separate entry point so running them is always a
 * deliberate choice rather than a side effect of the full suite.
 *
 * Run: DEEPSEEK_API_KEY=sk-... npx vitest run --config vitest.live.config.mts
 */
export default defineConfig({
  test: {
    include: ["src/**/*.live.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
