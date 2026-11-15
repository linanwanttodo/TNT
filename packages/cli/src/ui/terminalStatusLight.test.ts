import fs from "fs";

import { render } from "ink-testing-library";
import React from "react";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sessionTitle,
  TITLE_MAX_LENGTH,
  useTerminalStatusLight,
  writeTerminalTitle,
  type SessionStatus,
} from "./terminalStatusLight.js";

const OLD_STATUS_EMOJI = /[\u{1F7E2}\u{1F7E1}\u{1F534}]/u;

describe("sessionTitle", () => {
  const cases: Array<[SessionStatus, string, string]> = [
    ["idle", "myproject", "TNT myproject"],
    ["working", "myproject", "TNT myproject"],
    ["waiting", "myproject", "TNT myproject"],
    ["idle", "", "TNT"],
    ["working", "  ", "TNT"],
  ];

  for (const [status, name, expected] of cases) {
    it(`renders ${status} with name "${name}"`, () => {
      expect(sessionTitle(status, name)).toBe(expected);
    });
  }

  it("keeps the title to the product and working directory", () => {
    for (const status of ["idle", "working", "waiting"] as const) {
      expect(sessionTitle(status, "tnt", 960)).toBe("TNT tnt");
    }
  });

  it("leaves no emoji status glyph", () => {
    for (const status of ["idle", "working", "waiting"] as const) {
      expect(sessionTitle(status, "tnt"), status).not.toMatch(OLD_STATUS_EMOJI);
    }
  });
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

  it("writes an OSC 0 title when attached to a terminal", () => {
    setIsTTY(true);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle("TNT tnt");

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;TNT tnt\x07");
  });

  it("writes nothing when stdout is not a terminal", () => {
    setIsTTY(false);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle("TNT tnt");

    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("keeps control characters out of the title payload", () => {
    setIsTTY(true);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    // The session name is model-chosen, and both BEL and ESC end an OSC
    // string: either one inside the name lets it close the title and hand the
    // remainder to the terminal as control.
    writeTerminalTitle("TNT ok\u0007\u001b]0;pwned\u0007");

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;TNT ok]0;pwned\x07");
  });

  it("keeps newlines out of the title payload", () => {
    setIsTTY(true);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle("TNT a\u0009b\u000ac");

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;TNT abc\x07");
  });

  it("bounds the title length", () => {
    setIsTTY(true);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle("x".repeat(TITLE_MAX_LENGTH + 50));

    expect(stdoutWrite).toHaveBeenCalledWith(
      `\x1b]0;${"x".repeat(TITLE_MAX_LENGTH)}\x07`,
    );
  });
});

describe("the title source", () => {
  it("carries no emoji glyph", () => {
    const source = fs.readFileSync(
      new URL("./terminalStatusLight.ts", import.meta.url),
      "utf-8",
    );

    expect(source).not.toMatch(OLD_STATUS_EMOJI);
  });
});

describe("useTerminalStatusLight", () => {
  let stdoutWrite: MockInstance;
  let setIntervalSpy: MockInstance;
  let clearIntervalSpy: MockInstance;
  const originalIsTTY = process.stdout.isTTY;

  function Harness(props: {
    status: SessionStatus;
    sessionName: string;
  }): null {
    useTerminalStatusLight(props.status, props.sessionName);
    return null;
  }

  function draw(status: SessionStatus): ReturnType<typeof render> {
    return render(React.createElement(Harness, { status, sessionName: "tnt" }));
  }

  function animationTimer(): unknown {
    return setIntervalSpy.mock.results.at(-1)?.value;
  }

  beforeEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);
    setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it("writes the stable TNT and workspace title while working", () => {
    const tree = draw("working");

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;TNT tnt\x07");
    expect(animationTimer()).toBeUndefined();

    tree.unmount();
  });

  it("keeps the same title when the turn ends", () => {
    const tree = draw("working");
    tree.rerender(
      React.createElement(Harness, { status: "idle", sessionName: "tnt" }),
    );
    expect(stdoutWrite).toHaveBeenLastCalledWith("\x1b]0;TNT tnt\x07");
    expect(animationTimer()).toBeUndefined();
    tree.unmount();
  });

  it("never starts an animation when it mounts idle", () => {
    const tree = draw("idle");

    expect(animationTimer()).toBeUndefined();
    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;TNT tnt\x07");

    tree.unmount();
  });

  it("restores the idle title on unmount", () => {
    const tree = draw("working");

    tree.unmount();

    expect(stdoutWrite).toHaveBeenLastCalledWith("\x1b]0;TNT tnt\x07");
  });
});
