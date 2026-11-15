import fs from "fs";
import path from "path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * The config file is edited in place when the user picks a model, so a write
 * interrupted partway through would leave the file the CLI reads at startup
 * corrupt. The edit goes to a temporary file and is renamed into place.
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

const { editConfigFile, getConfigYamlPath } = await import("./paths.js");

function leftoverTemporaryFiles(): string[] {
  const file = getConfigYamlPath();
  const dir = path.dirname(file);
  const base = path.basename(file);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".tmp"));
}

afterEach(() => {
  control.failWriteFor = null;
});

afterAll(() => {
  for (const file of [getConfigYamlPath(), ...leftoverTemporaryFiles()]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

describe("editing the config file", () => {
  it("writes the edit and leaves no temporary file behind", () => {
    editConfigFile(
      () => ({}) as never,
      (config) => ({ ...config, name: "edited" }) as never,
    );

    expect(fs.readFileSync(getConfigYamlPath(), "utf-8")).toContain(
      "name: edited",
    );
    expect(leftoverTemporaryFiles()).toEqual([]);
  });

  it("keeps the previous config when a write dies partway through", () => {
    editConfigFile(
      () => ({}) as never,
      (config) => ({ ...config, name: "before" }) as never,
    );
    const before = fs.readFileSync(getConfigYamlPath(), "utf-8");

    // Fires for the config file and for a temporary file beside it alike.
    control.failWriteFor = ".yaml";

    expect(() =>
      editConfigFile(
        () => ({}) as never,
        (config) => ({ ...config, name: "after" }) as never,
      ),
    ).toThrow();

    expect(fs.readFileSync(getConfigYamlPath(), "utf-8")).toBe(before);
  });
});
