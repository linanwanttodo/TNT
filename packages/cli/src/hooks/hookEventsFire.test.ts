import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { HOOK_EVENT_NAMES, UNFIRED_HOOK_EVENTS } from "./types.js";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Naming an event in `HOOK_EVENT_NAMES` is a promise that a plugin or a
 * settings file can hang a hook on it. Four names are accepted only for
 * cross-CLI compatibility and are listed in `UNFIRED_HOOK_EVENTS`, which keeps
 * them honest; every other name has to have a `fire<Name>` wrapper in
 * fireHook.ts and a caller outside the tests, or it is a configuration that
 * silently does nothing.
 */
function productionSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__mocks__") {
        found.push(...productionSources(full));
      }
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.includes(".test.") &&
      !full.endsWith(path.join("hooks", "fireHook.ts")) &&
      !full.endsWith(path.join("hooks", "types.ts"))
    ) {
      found.push(full);
    }
  }
  return found;
}

describe("the hook events the CLI claims to support", () => {
  const fireHookSource = fs.readFileSync(
    path.join(srcDir, "hooks", "fireHook.ts"),
    "utf-8",
  );
  const sources = productionSources(srcDir);

  it("walks enough production sources for the check to mean something", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("routes every declared event to a wrapper that something calls", () => {
    const unfired = new Set<string>(UNFIRED_HOOK_EVENTS);

    const inert = HOOK_EVENT_NAMES.filter((event) => {
      if (unfired.has(event)) return false;
      const declared = new RegExp(`export (?:async )?function fire${event}\\b`);
      if (!declared.test(fireHookSource)) return true;
      const called = new RegExp(`\\bfire${event}\\(`);
      return !sources.some((file) =>
        called.test(fs.readFileSync(file, "utf-8")),
      );
    });

    expect(inert).toEqual([]);
  });

  it("keeps the unfired list inside the declared vocabulary", () => {
    const declared = new Set<string>(HOOK_EVENT_NAMES);
    expect(UNFIRED_HOOK_EVENTS.filter((event) => !declared.has(event))).toEqual(
      [],
    );
    expect(UNFIRED_HOOK_EVENTS.length).toBeLessThan(
      HOOK_EVENT_NAMES.length / 2,
    );
  });
});
