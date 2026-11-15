import { describe, expect, it, vi } from "vitest";

import { ComposerTerminalFilter } from "./composerTerminalFilter.js";

describe("ComposerTerminalFilter", () => {
  it("returns replaced text instead of dropping the next keystroke", () => {
    const filter = new ComposerTerminalFilter(vi.fn(), vi.fn());

    expect(filter.consume("]")).toBeNull();
    expect(filter.consume("abc")).toBe("abc");
  });

  it("drops a raw OSC reply delivered in one read", () => {
    const filter = new ComposerTerminalFilter(vi.fn(), vi.fn());

    expect(filter.consume("\x1b]11;rgb:0000/0000/0000\x1b\\")).toBeNull();
  });
});
