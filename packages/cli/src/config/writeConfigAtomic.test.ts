import fs from "fs";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The config file decides which model the CLI will use, so a write interrupted
 * partway through leaves a file that either fails to parse or silently loses the
 * model. The write goes to a temporary file and is renamed into place.
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

const { CONFIG_PATH, writeConfig } = await import("./providerSetup.js");

function leftoverTemporaryFiles(): string[] {
  const dir = path.dirname(CONFIG_PATH);
  const base = path.basename(CONFIG_PATH);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".tmp"));
}

afterEach(() => {
  control.failWriteFor = null;
  for (const file of [CONFIG_PATH, ...leftoverTemporaryFiles()]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

describe("writing the config file", () => {
  it("writes it whole, with no temporary file left behind", () => {
    writeConfig("name: first\n");

    expect(fs.readFileSync(CONFIG_PATH, "utf-8")).toBe("name: first\n");
    expect(leftoverTemporaryFiles()).toEqual([]);
  });

  it("keeps the previous config when a write dies partway through", () => {
    writeConfig("name: first\n");
    const before = fs.readFileSync(CONFIG_PATH, "utf-8");

    // Fires for the config file and for a temporary file beside it alike.
    control.failWriteFor = ".yaml";

    expect(() => writeConfig("name: second\n")).toThrow();

    expect(fs.readFileSync(CONFIG_PATH, "utf-8")).toBe(before);
  });
});
