import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTransformMode: {
      web: ["/.[jt]s?$/"],
      ssr: ["/.[jt]s?$/"],
    },
    globalSetup: "./test/vitest.global-setup.ts",
    setupFiles: "./test/vitest.setup.ts",
    fileParallelism: false,
    // The suite was written against a 10s ceiling; keep it rather than tighten.
    testTimeout: 10000,
    include: ["**/*.vitest.ts"],
  },
});
