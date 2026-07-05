import fs from "fs";

import { render } from "ink-testing-library";
import React from "react";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sessionTitle,
  TITLE_ANIMATION_INTERVAL_MS,
  TITLE_MAX_LENGTH,
  titlePrefixAt,
  useTerminalStatusLight,
  writeTerminalTitle,
  type SessionStatus,
} from "./terminalStatusLight.js";

const STATIC_PREFIX = "✳";
const FRAME_A = "⠂";
const FRAME_B = "⠐";
const OLD_STATUS_EMOJI = /[\u{1F7E2}\u{1F7E1}\u{1F534}]/u;

describe("titlePrefixAt", () => {
  it("alternates every 960 ms while a turn runs", () => {
    expect(titlePrefixAt(0, true)).toBe(FRAME_A);
    expect(titlePrefixAt(959, true)).toBe(FRAME_A);
    expect(titlePrefixAt(960, true)).toBe(FRAME_B);
    expect(titlePrefixAt(1919, true)).toBe(FRAME_B);
    expect(titlePrefixAt(1920, true)).toBe(FRAME_A);
  });

  it("keeps the static prefix whenever no turn runs", () => {
    for (const elapsed of [0, 959, 960, 1919, 1920, 50_000]) {
      expect(titlePrefixAt(elapsed, false), `${elapsed} ms`).toBe(
        STATIC_PREFIX,
      );
    }
  });

  it("treats a negative clock as the start of the turn", () => {
    expect(titlePrefixAt(-960, true)).toBe(FRAME_A);
  });
});

describe("sessionTitle", () => {
  const cases: Array<[SessionStatus, string, string]> = [
    ["idle", "myproject", `${STATIC_PREFIX} myproject`],
    ["working", "myproject", `${FRAME_A} myproject`],
    ["waiting", "myproject", `${STATIC_PREFIX} myproject`],
    ["idle", "", STATIC_PREFIX],
    ["working", "  ", FRAME_A],
  ];

  for (const [status, name, expected] of cases) {
    it(`renders ${status} with name "${name}"`, () => {
      expect(sessionTitle(status, name)).toBe(expected);
    });
  }

  it("uses the same prefix for every state and animates only while working", () => {
    expect(sessionTitle("idle", "tnt", 960)).toBe(`${STATIC_PREFIX} tnt`);
    expect(sessionTitle("waiting", "tnt", 960)).toBe(`${STATIC_PREFIX} tnt`);
    expect(sessionTitle("working", "tnt", 0)).toBe(`${FRAME_A} tnt`);
    expect(sessionTitle("working", "tnt", 960)).toBe(`${FRAME_B} tnt`);
  });

  it("leaves no emoji status glyph", () => {
    for (const status of ["idle", "working", "waiting"] as const) {
      expect(sessionTitle(status, "tnt"), status).not.toMatch(OLD_STATUS_EMOJI);
      expect(sessionTitle(status, "tnt", 1920), status).not.toMatch(
        OLD_STATUS_EMOJI,
      );
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

    writeTerminalTitle(`${FRAME_A} tnt`);

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;⠂ tnt\x07");
  });

  it("writes nothing when stdout is not a terminal", () => {
    setIsTTY(false);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle(`${FRAME_A} tnt`);

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
    writeTerminalTitle(`${FRAME_A} ok\u0007\u001b]0;pwned\u0007`);

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;⠂ ok]0;pwned\x07");
  });

  it("keeps newlines out of the title payload", () => {
    setIsTTY(true);
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    writeTerminalTitle(`${FRAME_A} a\u0009b\u000ac`);

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;⠂ abc\x07");
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

  /** The id of the 960 ms animation timer, if the hook started one. */
  function animationTimer(): unknown {
    const index = setIntervalSpy.mock.calls.findIndex(
      (call: unknown[]) => call[1] === TITLE_ANIMATION_INTERVAL_MS,
    );
    return index < 0 ? undefined : setIntervalSpy.mock.results[index]?.value;
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

  it("starts a 960 ms animation and writes its first frame while working", () => {
    const tree = draw("working");

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;⠂ tnt\x07");
    expect(animationTimer()).toBeDefined();

    tree.unmount();
  });

  it("stops the animation when the turn ends", () => {
    const tree = draw("working");
    const timer = animationTimer();

    tree.rerender(
      React.createElement(Harness, { status: "idle", sessionName: "tnt" }),
    );

    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;✳ tnt\x07");
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);

    tree.unmount();
  });

  it("never starts an animation when it mounts idle", () => {
    const tree = draw("idle");

    expect(animationTimer()).toBeUndefined();
    expect(stdoutWrite).toHaveBeenCalledWith("\x1b]0;✳ tnt\x07");

    tree.unmount();
  });

  it("restores the idle title on unmount", () => {
    const tree = draw("working");

    tree.unmount();

    expect(stdoutWrite).toHaveBeenLastCalledWith("\x1b]0;✳ tnt\x07");
  });
});
