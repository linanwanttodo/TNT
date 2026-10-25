import { PassThrough } from "stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  colorfgbgIsDark,
  normalizeThemeChoice,
  parseOsc11Color,
  perceivedBrightness,
  probeTerminalIsDark,
  resolveThemeName,
  setDetectedTerminalIsDark,
} from "./terminalAppearance.js";

function fakeStreams() {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (mode: boolean) => void;
  };
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (mode: boolean) => {
    stdin.isRaw = mode;
  };
  const stdout = new PassThrough();
  const written: string[] = [];
  stdout.on("data", (chunk: Buffer) => written.push(String(chunk)));
  return { stdin, stdout, written };
}

afterEach(() => {
  setDetectedTerminalIsDark(undefined);
  delete process.env.COLORFGBG;
});

describe("parseOsc11Color", () => {
  it("reads a four-digit ST-terminated answer", () => {
    expect(parseOsc11Color("\x1b]11;rgb:1e1e/2a2a/3131\x1b\\")).toEqual({
      r: 0x1e,
      g: 0x2a,
      b: 0x31,
    });
  });

  it("reads a two-digit BEL-terminated answer", () => {
    expect(parseOsc11Color("\x1b]11;rgb:1e/2a/31\x07")).toEqual({
      r: 0x1e,
      g: 0x2a,
      b: 0x31,
    });
  });

  it("returns undefined for keypress noise", () => {
    expect(parseOsc11Color("abc")).toBeUndefined();
  });
});

describe("perceivedBrightness", () => {
  it("ranks white far above black", () => {
    expect(perceivedBrightness({ r: 255, g: 255, b: 255 })).toBeGreaterThan(
      200,
    );
    expect(perceivedBrightness({ r: 0, g: 0, b: 0 })).toBeLessThan(30);
  });
});

describe("colorfgbgIsDark", () => {
  it("treats dark slots as dark", () => {
    expect(colorfgbgIsDark("15;0")).toBe(true);
    expect(colorfgbgIsDark("15;8")).toBe(true);
  });

  it("treats light slots as light", () => {
    expect(colorfgbgIsDark("0;15")).toBe(false);
    expect(colorfgbgIsDark("0;7")).toBe(false);
  });

  it("is undefined without the variable", () => {
    expect(colorfgbgIsDark(undefined)).toBeUndefined();
    expect(colorfgbgIsDark("not-a-number")).toBeUndefined();
  });
});

describe("probeTerminalIsDark", () => {
  it("answers from COLORFGBG without writing to the terminal", async () => {
    process.env.COLORFGBG = "0;15";
    const { stdin, stdout, written } = fakeStreams();

    expect(await probeTerminalIsDark({ stdin, stdout }, 50)).toBe(false);
    expect(written).toEqual([]);
  });

  it("reads the terminal answer over OSC 11", async () => {
    const { stdin, stdout } = fakeStreams();
    const probing = probeTerminalIsDark({ stdin, stdout }, 500);
    stdin.emit("data", "\x1b]11;rgb:ffff/ffff/ffff\x1b\\");

    expect(await probing).toBe(false);
  });

  it("falls back to dark when the terminal stays silent", async () => {
    const { stdin, stdout } = fakeStreams();

    expect(await probeTerminalIsDark({ stdin, stdout }, 30)).toBe(true);
  });
});

describe("normalizeThemeChoice", () => {
  it("keeps auto as a choice and resolves named settings", () => {
    expect(normalizeThemeChoice(undefined)).toBe("auto");
    expect(normalizeThemeChoice("AUTO")).toBe("auto");
    expect(normalizeThemeChoice("tencent-light")).toBe("tencent-light");
    expect(normalizeThemeChoice("odd")).toBe("dark");
  });
});

describe("resolveThemeName", () => {
  it("passes explicit names through", () => {
    expect(resolveThemeName("dark")).toBe("dark");
    expect(resolveThemeName("tencent-light")).toBe("tencent-light");
    expect(resolveThemeName("SOMETHING-odd")).toBe("dark");
  });

  it("follows the probe for auto", () => {
    setDetectedTerminalIsDark(false);
    expect(resolveThemeName("auto")).toBe("light");
    expect(resolveThemeName(undefined)).toBe("light");

    setDetectedTerminalIsDark(true);
    expect(resolveThemeName(undefined)).toBe("dark");
  });

  it("defaults to dark when nothing was detected", () => {
    expect(resolveThemeName("auto")).toBe("dark");
  });
});
