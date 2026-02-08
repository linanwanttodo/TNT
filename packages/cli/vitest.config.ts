import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.global-dir-setup.ts", "./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.e2e.*", "**/e2e/**"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/test-utils/**",
        "**/types/**",
        "**/__mocks__/**",
      ],
      // The floor sits a little under the measured numbers (72.9 statements,
      // 82.6 branches, 83.0 functions) so a platform difference does not fail
      // the build, while a real slide does. Raise it when the numbers rise.
      thresholds: {
        statements: 70,
        branches: 80,
        functions: 80,
        lines: 70,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, "src"),
    },
    extensions: [".js", ".ts", ".tsx", ".json"],
  },
});
