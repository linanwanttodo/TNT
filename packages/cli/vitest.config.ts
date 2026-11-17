import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.global-dir-setup.ts", "./vitest.setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.e2e.*",
      "**/e2e/**",
      // The webui subapp runs its own suite (npm test inside webui/) under a
      // jsdom environment; the CLI's node environment cannot render it.
      "webui/**",
      // The benchmark's fixtures are data: one of them is a test file on
      // purpose, because a spec that names the same symbols as its
      // implementation is exactly the distractor the near-miss track needs.
      "**/eval/retrieval/corpus/**",
    ],
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
        "eval/retrieval/corpus/",
        // The webui subapp runs its own jsdom suite inside webui/; counting
        // its sources here would report them at zero forever.
        "webui/",
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
    // 30s starved process-spawning tests on loaded CI runners; 60s gives
    // them headroom without masking a hang (the terminal tool bounds itself).
    testTimeout: 60000,
    hookTimeout: 60000,
    // A loaded runner cannot give every test file its own worker: the suite
    // spawns processes and renders frames, and the starved ones time out
    // rather than fail. Unset locally (vitest's default parallelism), capped
    // in CI through TNT_TEST_MAX_WORKERS.
    maxWorkers: process.env.TNT_TEST_MAX_WORKERS
      ? Number(process.env.TNT_TEST_MAX_WORKERS)
      : undefined,
    // One retry in CI absorbs timing flakes of the classes above — process
    // spawning and frame rendering on a shared runner — while a consistently
    // broken test still fails both attempts.
    retry: process.env.CI ? 1 : 0,
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, "src"),
    },
    extensions: [".js", ".ts", ".tsx", ".json"],
  },
});
