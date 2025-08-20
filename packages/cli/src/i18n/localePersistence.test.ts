import fs from "fs";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../config/env.js";

/**
 * The locale is stored in settings.json, the same file the hook loader reads,
 * so a write interrupted partway through takes the hooks configuration with it.
 * The write now goes to a temporary file and is renamed into place.
 */
const SETTINGS_PATH = path.join(env.continueHome, "settings.json");
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

const { getLocale, setLocale } = await import("./index.js");

function leftoverTemporaryFiles(): string[] {
  const dir = path.dirname(SETTINGS_PATH);
  const base = path.basename(SETTINGS_PATH);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".tmp"));
}

function otherLocale(): "en" | "zh-CN" {
  return getLocale() === "en" ? "zh-CN" : "en";
}

afterEach(() => {
  control.failWriteFor = null;
  for (const file of [SETTINGS_PATH, ...leftoverTemporaryFiles()]) {
    fs.rmSync(file, { force: true });
  }
});

describe("the stored locale", () => {
  it("writes the locale whole and keeps the other settings", () => {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ theme: "dark" }));

    setLocale(otherLocale());

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    expect(settings.locale).toBe(getLocale());
    expect(settings.theme).toBe("dark");
    expect(leftoverTemporaryFiles()).toEqual([]);
  });

  it("keeps the previous settings when the write dies partway through", () => {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ theme: "dark" }));
    const before = fs.readFileSync(SETTINGS_PATH, "utf-8");

    // Fires for the settings file and for a temporary file beside it alike.
    control.failWriteFor = "settings.json";

    setLocale(otherLocale());

    expect(fs.readFileSync(SETTINGS_PATH, "utf-8")).toBe(before);
  });
});
