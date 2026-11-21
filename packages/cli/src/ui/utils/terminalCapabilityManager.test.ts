import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `detectCapabilities` reads the global terminal streams directly, so the
 * cases replace them with fakes: a stdin whose answers the test writes, and a
 * stdout whose fd only records what the probe asked for.
 */
const state = vi.hoisted(() => ({ writes: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeSync: (_fd: number, data: string | Buffer): number => {
      state.writes.push(String(data));
      return 0;
    },
  };
});

class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  readableFlowing: boolean | null = null;
  setRawMode = vi.fn((raw: boolean) => {
    this.isRaw = raw;
  });
  pause = vi.fn();
}

const VTE_ANSWER_SET =
  // XTVERSION (terminal name): DCS >| name ST.
  "\x1bP>|VTE(8400)\x1b\\" +
  // Cursor Position Report for the ambiguous-width probe, column 3: wide.
  "\x1b[1;3R" +
  // Primary Device Attributes, five fields, exactly what VTE sends.
  "\x1b[?61;1;21;22;28c";

async function loadManager() {
  const module = await import("./terminalCapabilityManager.js");
  return module;
}

let stdin: FakeStdin;

beforeEach(() => {
  state.writes.length = 0;
  stdin = new FakeStdin();
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    stdin as unknown as NodeJS.ReadStream & { fd: 0 },
  );
  vi.spyOn(process, "stdout", "get").mockReturnValue({
    fd: 1,
    isTTY: true,
    write: vi.fn(),
  } as unknown as NodeJS.WriteStream & { fd: 1 });
});

afterEach(async () => {
  const { cleanupTerminalOnExit } = await loadManager();
  process.removeListener("exit", cleanupTerminalOnExit);
  process.removeListener("SIGTERM", cleanupTerminalOnExit);
  process.removeListener("SIGINT", cleanupTerminalOnExit);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("terminalCapabilityManager.detectCapabilities", () => {
  it("reads a multi-field device attributes reply as the sentinel", async () => {
    const { terminalCapabilityManager } = await loadManager();

    const detection = terminalCapabilityManager.detectCapabilities();
    expect(state.writes.join("")).toContain("\x1b[c");

    stdin.emit("data", Buffer.from(VTE_ANSWER_SET));
    const startedAt = Date.now();
    await detection;

    // The old pattern only matched one or two fields, so a real answer never
    // fired the sentinel and the probe waited out its full timeout.
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(terminalCapabilityManager.getTerminalName()).toBe("VTE(8400)");
    expect(terminalCapabilityManager.areAmbiguousCharactersWide()).toBe(true);
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.isRaw).toBe(false);
  });

  it("resolves on the timeout when the terminal answers nothing", async () => {
    vi.useFakeTimers();
    const { terminalCapabilityManager } = await loadManager();

    const detection = terminalCapabilityManager.detectCapabilities();
    let settled = false;
    void detection.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(299);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(stdin.listenerCount("data")).toBe(0);
  });
});
