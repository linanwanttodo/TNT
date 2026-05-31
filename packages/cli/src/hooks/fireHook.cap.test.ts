import { describe, expect, it } from "vitest";

import { capHookContext } from "./fireHook.js";

describe("the hook context budget", () => {
  it("leaves short context untouched", () => {
    const note =
      "<EXTREMELY_IMPORTANT>You have superpowers.</EXTREMELY_IMPORTANT>";
    expect(capHookContext(note)).toBe(note);
  });

  it("truncates a plugin that ships a whole manual", () => {
    const manual = "x".repeat(50_000);
    const capped = capHookContext(manual);

    expect(capped.length).toBeLessThan(manual.length);
    expect(capped).toContain("hook context truncated");
    expect(capped).toContain("Skills tool");
  });

  it("keeps the truncation point inside the budget", () => {
    const capped = capHookContext("y".repeat(10_000));
    // The budget plus the marker, with slack for the notice line.
    expect(capped.length).toBeLessThan(4_200);
  });
});
