import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The global context holds settings that are read back at startup, so a write
 * interrupted partway through leaves a file that fails to parse. The class
 * already tolerates a corrupt file by salvaging what it can, which is a sign
 * that it does happen; the write now goes to a temporary file and is renamed.
 */
const control = vi.hoisted(() => ({ failWriteFor: null as string | null }));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const writeFileSync = (
    target: unknown,
    data: unknown,
    ...rest: unknown[]
  ) => {
    if (control.failWriteFor && String(target).includes(control.failWriteFor)) {
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
  return { ...actual, writeFileSync, default: { ...actual, writeFileSync } };
});

let GlobalContext: typeof import("./GlobalContext.js").GlobalContext;
let paths: typeof import("./paths.js");

// The path the code actually writes to, rather than one this test assumes: the
// global directory is resolved when the paths module first loads.
function contextFile(): string {
  return paths.getGlobalContextFilePath();
}

beforeAll(async () => {
  ({ GlobalContext } = await import("./GlobalContext.js"));
  paths = await import("./paths.js");
});

afterAll(() => {
  for (const file of [contextFile(), `${contextFile()}.tmp`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

describe("the global context file", () => {
  it("writes it whole, with no temporary file left behind", () => {
    const context = new GlobalContext();

    context.update("selectedModelsByProfileId", {
      profileA: { chat: "gpt" },
    });

    expect(fs.existsSync(`${contextFile()}.tmp`)).toBe(false);
    const written = JSON.parse(fs.readFileSync(contextFile(), "utf-8"));
    expect(written.selectedModelsByProfileId).toEqual({
      profileA: { chat: "gpt" },
    });
  });

  it("keeps the previous contents when a write dies partway through", () => {
    const context = new GlobalContext();
    context.update("selectedModelsByProfileId", {
      profileA: { chat: "gpt" },
    });
    const before = fs.readFileSync(contextFile(), "utf-8");

    // Fires for the context file and for a temporary file beside it alike.
    control.failWriteFor = "globalContext";

    expect(() =>
      context.update("selectedModelsByProfileId", {
        profileA: { chat: "other" },
      }),
    ).toThrow();

    expect(fs.readFileSync(contextFile(), "utf-8")).toBe(before);
    expect(JSON.parse(before).selectedModelsByProfileId.profileA.chat).toBe(
      "gpt",
    );
    control.failWriteFor = null;
  });
});
