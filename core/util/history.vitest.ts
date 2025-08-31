import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A session file is the only copy of a conversation. It used to be written with
 * a plain write, so a crash or a full disk partway through left a truncated file
 * that the session listing then skipped without saying anything.
 *
 * This lives beside the writer rather than in the CLI: the CLI loads the built
 * core as an external dependency, and a fault injected through a module mock
 * over there never reaches these calls.
 */
const control = vi.hoisted(() => ({
  failWriteFor: null as string | null,
  failRename: false,
  writes: 0,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const writeFileSync = (
    target: unknown,
    data: unknown,
    ...rest: unknown[]
  ) => {
    control.writes += 1;
    if (control.failWriteFor && String(target).includes(control.failWriteFor)) {
      // Half the bytes reach the disk, then the write fails.
      const text = String(data);
      (actual.writeFileSync as (...args: unknown[]) => void)(
        target as never,
        text.slice(0, Math.floor(text.length / 2)) as never,
      );
      throw new Error("no space left on device");
    }
    return (actual.writeFileSync as (...args: unknown[]) => void)(
      target as never,
      data as never,
      ...rest,
    );
  };
  const renameSync = (from: unknown, to: unknown) => {
    if (control.failRename) {
      throw new Error("no space left on device");
    }
    return actual.renameSync(from as never, to as never);
  };
  return {
    ...actual,
    writeFileSync,
    renameSync,
    default: { ...actual, writeFileSync, renameSync },
  };
});

let globalDir: string;
let historyManager: typeof import("./history.js").default;
let sessionDir: string;

interface TestSession {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
  history: { message: { role: string; content: string } }[];
}

function sessionWith(turns: number): TestSession {
  return {
    sessionId: `atomic-${Date.now()}-${turns}`,
    title: "Atomic save",
    workspaceDirectory: process.cwd(),
    history: Array.from({ length: turns }, (_, index) => ({
      message: { role: "user", content: `turn ${index}` },
    })),
  };
}

function writePathFor(session: TestSession): string {
  return path.join(sessionDir, `${session.sessionId}.json`);
}

beforeAll(async () => {
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-history-"));
  // Resolved when the paths module is first imported, so it has to be set first.
  process.env.CONTINUE_GLOBAL_DIR = globalDir;
  sessionDir = path.join(globalDir, "sessions");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "sessions.json"), "[]");
  ({ default: historyManager } = await import("./history.js"));
});

afterAll(() => {
  fs.rmSync(globalDir, { recursive: true, force: true });
});

describe("the session writer", () => {
  it("writes the file whole and leaves no temporary file behind", () => {
    const session = sessionWith(1);

    historyManager.save(session as never);

    const file = writePathFor(session);
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).history).toHaveLength(1);
    expect(
      fs.readdirSync(sessionDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("keeps the previous conversation when a write dies partway through", () => {
    const first = sessionWith(1);
    historyManager.save(first as never);
    const file = writePathFor(first);
    const before = fs.readFileSync(file, "utf-8");
    const writesBefore = control.writes;

    // Fires for the session file and for a temporary file beside it alike, so a
    // plain write truncates the conversation while a two-step write does not.
    control.failWriteFor = ".json";
    expect(() =>
      historyManager.save({
        ...first,
        history: [...first.history, ...first.history],
      } as never),
    ).toThrow();

    expect(control.writes).toBeGreaterThan(writesBefore);
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
    expect(JSON.parse(before).history).toHaveLength(1);
    control.failWriteFor = null;
  });

  it("keeps the previous conversation when the final step fails", () => {
    const session = sessionWith(2);
    historyManager.save(session as never);
    const file = writePathFor(session);
    const before = fs.readFileSync(file, "utf-8");

    control.failRename = true;
    expect(() =>
      historyManager.save({
        ...session,
        history: [session.history[0]],
      } as never),
    ).toThrow();

    expect(fs.readFileSync(file, "utf-8")).toBe(before);
    control.failRename = false;
  });

  it("persists the optional fields the readers depend on", () => {
    const session = {
      ...sessionWith(3),
      goal: "Ship the release",
      outputStyle: "plugin:terse",
      parentSessionId: "parent-1",
      subagentType: "Explore",
      delegationDepth: 2,
    };

    historyManager.save(session as never);

    const written = JSON.parse(fs.readFileSync(writePathFor(session), "utf-8"));
    expect(written.goal).toBe("Ship the release");
    expect(written.outputStyle).toBe("plugin:terse");
    expect(written.parentSessionId).toBe("parent-1");
    expect(written.subagentType).toBe("Explore");
    expect(written.delegationDepth).toBe(2);
    // The ordered keys still open the file so it stays readable by hand.
    expect(Object.keys(written).slice(0, 4)).toEqual([
      "sessionId",
      "title",
      "workspaceDirectory",
      "history",
    ]);
  });
});
