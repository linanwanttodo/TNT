import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alternateScreenEnabled,
  enterAlternateScreen,
  leaveAlternateScreen,
} from "./terminalScreen.js";

const writes: string[] = [];
const originalIsTTY = process.stdout.isTTY;

function fakeTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    value: isTTY,
    configurable: true,
  });
}

afterEach(() => {
  leaveAlternateScreen();
  writes.length = 0;
  vi.restoreAllMocks();
  fakeTTY(originalIsTTY as boolean);
});

describe("alternate screen", () => {
  it("enters once and leaves when the app tears down", () => {
    fakeTTY(true);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    enterAlternateScreen();
    enterAlternateScreen();
    expect(
      writes.filter((chunk) => chunk.includes("\u001b[?1049h")),
    ).toHaveLength(1);

    leaveAlternateScreen();
    leaveAlternateScreen();
    expect(writes.filter((chunk) => chunk === "\u001b[?1049l")).toHaveLength(1);
  });

  it("writes nothing when stdout is not a terminal", () => {
    fakeTTY(false);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    enterAlternateScreen();
    leaveAlternateScreen();
    expect(writes).toEqual([]);
  });
});

describe("alternateScreenEnabled", () => {
  it("defaults to the alternate buffer and honours the off spellings", () => {
    expect(alternateScreenEnabled({})).toBe(true);
    for (const value of ["1", "true", "on", " ON "]) {
      expect(alternateScreenEnabled({ TNT_ALT_SCREEN: value }), value).toBe(
        true,
      );
    }
    for (const value of ["0", "false", "off", " OFF "]) {
      expect(alternateScreenEnabled({ TNT_ALT_SCREEN: value }), value).toBe(
        false,
      );
    }
  });
});
