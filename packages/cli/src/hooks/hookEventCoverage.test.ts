import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `src/hooks/types.ts` opens with "These types match the exact schemas from Claude
 * Code so that any hook written for `claude` works with `tnt` out of the box", and it
 * declares seventeen event names. Four of them are never fired by any production
 * source: `TeammateIdle`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`. A user
 * who configures one of those per the compatibility promise gets silence - the hook is
 * accepted, the settings file validates, and nothing ever calls it, which is the same
 * failure shape as a permission policy for a tool that is never offered.
 *
 * Deleting the four would change what a settings file accepts, so that stays the
 * owner's call. What is done here is that the gap is counted from the sources rather
 * than remembered: a fifth unfired event is refused, and closing one of these four
 * without removing it from the list is refused too.
 */
const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TYPES = path.join(sourceRoot, "hooks", "types.ts");

/** Compatibility-only events: none left as of 2026-10-20. */
const UNFIRED: string[] = [];

function declaredEvents(): string[] {
  const types = fs.readFileSync(TYPES, "utf-8");
  const start = types.indexOf("HOOK_EVENT_NAMES = [");
  const end = types.indexOf("] as const", start);
  if (start < 0 || end < 0) {
    throw new Error("the hook event list moved; this guard must move with it");
  }
  return [
    ...new Set(
      [...types.slice(start, end).matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]),
    ),
  ];
}

function productionFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      productionFiles(full, found);
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.includes(".test.") &&
      full !== TYPES // the declaration is not a fire site
    ) {
      found.push(full);
    }
  }
  return found;
}

function firedEvents(): Set<string> {
  const fired = new Set<string>();
  for (const file of productionFiles(sourceRoot)) {
    const source = fs.readFileSync(file, "utf-8");
    for (const match of source.matchAll(
      /hook_event_name:\s*"([A-Za-z]+)"|hookEventName:\s*"([A-Za-z]+)"/g,
    )) {
      fired.add(match[1] ?? match[2]);
    }
  }
  return fired;
}

describe("the hook events the package promises", () => {
  const declared = declaredEvents();
  const fired = firedEvents();
  const unfired = declared.filter((event) => !fired.has(event)).sort();

  it("counts a list that is really there", () => {
    // Both halves are floored so a scan that found nothing cannot report a clean
    // compatibility surface.
    expect(declared.length).toBeGreaterThanOrEqual(15);
    expect(fired.size).toBeGreaterThanOrEqual(12);
  });

  it("fires every event except the four named as debt", () => {
    expect(unfired).toEqual([...UNFIRED].sort());
  });

  it("keeps every named debt event still declared", () => {
    for (const event of UNFIRED) {
      expect(declared.includes(event), event).toBe(true);
    }
  });
});
