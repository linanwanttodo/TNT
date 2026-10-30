import type { MockInstance } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sessionTitle,
  writeTerminalTitle,
  type SessionStatus,
} from "./terminalStatusLight.js";

describe("sessionTitle", () => {
  const cases: Array<[SessionStatus, string, string]> = [
    ["idle", "myproject", "🟢 myproject"],
    ["working", "myproject", "🟡 myproject"],
    ["waiting", "myproject", "🔴 myproject"],
    ["idle", "", "🟢"],
    ["working", "  ", "🟡"],
  ];

  for (const [status, name, expected] of cases) {
    it(`renders ${status} with name "${name}"`, () => {
      expect(sessionTitle(status, name)).toBe(expected);
    });
  }
});

describe("writeTerminalTitle", () => {
  let stdoutWrite: MockInstance;
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    stdoutWrite.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  function setIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, "isTTY", {
      value,
      configurable: true,
    });
  }

  it("writes an OSC 2 title when attached to a terminal", () => {
    setIsTTY(true);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle("🟢 tnt");

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]2;🟢 tnt\x07");
  });

  it("writes nothing when stdout is not a terminal", () => {
    setIsTTY(false);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle("🟢 tnt");

    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
