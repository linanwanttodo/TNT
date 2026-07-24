import { afterEach, describe, expect, it, vi } from "vitest";

const { order, probeMock, renderMock } = vi.hoisted(() => {
  const order: string[] = [];
  const probeMock = vi.fn(async () => {
    order.push("probe");
    return true;
  });
  const renderMock = vi.fn(
    (_node?: unknown, _options?: Record<string, unknown>) => {
      order.push("render");
      return { unmount: vi.fn(), cleanup: vi.fn() };
    },
  );
  return { order, probeMock, renderMock };
});

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return { ...actual, render: renderMock };
});

vi.mock("./AppRoot.js", () => ({ AppRoot: () => null }));

vi.mock("./theme/terminalAppearance.js", () => ({
  detectedTerminalIsDark: vi.fn(() => undefined),
  probeTerminalIsDark: probeMock,
  setDetectedTerminalIsDark: vi.fn(),
}));

vi.mock("./utils/terminalScreen.js", () => ({
  alternateScreenEnabled: () => false,
  enterAlternateScreen: vi.fn(),
  leaveAlternateScreen: vi.fn(),
}));

vi.mock("../index.js", () => ({
  enableSigintHandler: vi.fn(),
  setTUIUnmount: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  initializeServices: vi.fn(),
}));

vi.mock("../services/ServiceContainerContext.js", () => ({
  ServiceContainerProvider: () => null,
}));

vi.mock("../utils/cli.js", () => ({
  isHeadlessMode: () => false,
  isTTYless: () => false,
}));

import { logger } from "../utils/logger.js";

import { startRemoteTUIChat, startTUIChat } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  order.length = 0;
  probeMock.mockClear();
  renderMock.mockClear();
});

describe("startTUIChat theme probe ordering", () => {
  it("awaits the terminal probe before the first render", async () => {
    const stdin = {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
    } as unknown as NodeJS.ReadStream;

    const view = await startTUIChat({
      skipOnboarding: true,
      customStdin: stdin,
    });

    try {
      expect(probeMock).toHaveBeenCalledTimes(1);
      expect(renderMock).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["probe", "render"]);
    } finally {
      view.unmount();
    }
  });

  it("restores console and stderr if the initial Ink render throws", async () => {
    const originalDebug = console.debug;
    const originalStderr = process.stderr.write;
    renderMock.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    const stdin = {
      isTTY: true,
      setRawMode: vi.fn(),
    } as unknown as NodeJS.ReadStream;
    await expect(
      startTUIChat({ skipOnboarding: true, customStdin: stdin }),
    ).rejects.toThrow("render failed");
    expect(console.debug).toBe(originalDebug);
    expect(process.stderr.write).toBe(originalStderr);
  });

  it.each(["local", "remote"])(
    "routes %s TUI diagnostics to logs, never the composer",
    async (mode) => {
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const records: string[] = [];
      vi.spyOn(logger, "info").mockImplementation((message) => {
        records.push(message);
        return logger as never;
      });
      vi.spyOn(logger, "warn").mockImplementation((message) => {
        records.push(message);
      });
      const originalDebug = console.debug;
      const originalError = console.error;
      const stdin = {
        isTTY: true,
        setRawMode: vi.fn(),
      } as unknown as NodeJS.ReadStream;
      const view =
        mode === "local"
          ? await startTUIChat({ skipOnboarding: true, customStdin: stdin })
          : await startRemoteTUIChat("http://localhost:3000");

      try {
        const stdoutStart = stdout.mock.calls.length;
        const stderrStart = stderr.mock.calls.length;
        console.debug("Failed to fetch favicon for %s", "https://github.com");
        console.error("Tool diagnostic: %s", "network down");
        const callback = vi.fn();
        process.stderr.write("Dependency wrote directly to stderr", callback);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(
          stdout.mock.calls
            .slice(stdoutStart)
            .map(([value]) => String(value))
            .join(""),
        ).not.toContain("Failed to fetch favicon");
        expect(
          stderr.mock.calls
            .slice(stderrStart)
            .map(([value]) => String(value))
            .join(""),
        ).not.toContain("Tool diagnostic");
        expect(records.join("\n")).toContain(
          "Failed to fetch favicon for https://github.com",
        );
        expect(records.join("\n")).toContain("Tool diagnostic: network down");
        expect(records.join("\n")).toContain(
          "Dependency wrote directly to stderr",
        );
        expect(renderMock.mock.calls.at(-1)?.[1]).toMatchObject({
          patchConsole: false,
        });
      } finally {
        view.unmount();
      }
      expect(console.debug).toBe(originalDebug);
      expect(console.error).toBe(originalError);
    },
  );
});
