import { describe, expect, test } from "vitest";

describe("Test environment", () => {
  test("should have TNT_GLOBAL_DIR env var set to .continue-test", () => {
    expect(process.env.TNT_GLOBAL_DIR).toBeDefined();
    expect(process.env.TNT_GLOBAL_DIR)?.toMatch(/\.continue-test$/);
  });
});
