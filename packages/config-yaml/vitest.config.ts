import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 13 of the 15 suites call `describe`/`it`/`expect` as globals, the way jest
    // declared them through `@types/jest`. Keeping the globals rather than
    // rewriting every file means the suites stay readable, but the types have to
    // come from vitest - see `types` in tsconfig.json.
    globals: true,
    // Carried over from `jest.config.mjs`: this suite was written against a 10s
    // ceiling, so a slower box is a real failure and not a flake to widen.
    testTimeout: 10000,
    include: ["**/*.vitest.ts"],
  },
});
