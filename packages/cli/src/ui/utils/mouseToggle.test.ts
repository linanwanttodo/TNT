import { describe, expect, it } from "vitest";

import { isTerminalMouseSequence } from "./mouse.js";

describe("mouse capture toggle contract", () => {
  it("MOUSE_ENABLE requests SGR mouse reporting and MOUSE_DISABLE revokes it", async () => {
    const { MOUSE_ENABLE, MOUSE_DISABLE } = await import("./mouse.js");
    expect(MOUSE_ENABLE).toContain("\x1b[?1000h");
    expect(MOUSE_ENABLE).toContain("\x1b[?1006h");
    expect(MOUSE_DISABLE).toContain("\x1b[?1000l");
  });

  it("mouse sequences are never read as key presses", () => {
    expect(isTerminalMouseSequence("\x1b[<0;12;34M")).toBe(true);
    expect(isTerminalMouseSequence("\x1b[<0;12;34m")).toBe(true);
    expect(isTerminalMouseSequence("hello")).toBe(false);
  });
});
