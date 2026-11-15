import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../config/env.js";

import { InputHistory } from "./inputHistory.js";

/**
 * The input history is the record of what the user typed, so a save
 * interrupted partway through loses the older entries with it. The save now
 * goes to a temporary file and is renamed into place.
 */
const HISTORY_FILE = path.join(env.continueHome, "input_history.json");
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

function leftoverTemporaryFiles(): string[] {
  const dir = path.dirname(HISTORY_FILE);
  const base = path.basename(HISTORY_FILE);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".tmp"));
}

beforeEach(() => {
  fs.rmSync(HISTORY_FILE, { force: true });
});

afterEach(() => {
  control.failWriteFor = null;
  for (const file of [HISTORY_FILE, ...leftoverTemporaryFiles()]) {
    fs.rmSync(file, { force: true });
  }
});

describe("the input history file", () => {
  it("writes the entry whole and leaves no temporary file behind", () => {
    const history = new InputHistory();

    history.addEntry("first command");

    expect(fs.readFileSync(HISTORY_FILE, "utf-8")).toContain("first command");
    expect(leftoverTemporaryFiles()).toEqual([]);
  });

  it("keeps the previous history when a save dies partway through", () => {
    const history = new InputHistory();
    history.addEntry("first command");
    const before = fs.readFileSync(HISTORY_FILE, "utf-8");

    // Fires for the history file and for a temporary file beside it alike.
    control.failWriteFor = "input_history";

    history.addEntry("second command");

    expect(fs.readFileSync(HISTORY_FILE, "utf-8")).toBe(before);
  });
});
