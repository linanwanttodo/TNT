import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/modes.md` is the page a user reads before deciding whether plan mode is safe.
 * It used to describe the upstream continue CLI: a `normal` mode instead of `agent`,
 * Bash "for command execution" in plan, a current directory hidden in plan and auto,
 * and `--allow` overridden instead of refused. None of those matched this package.
 *
 * Every claim on the page belongs to a source elsewhere - the mode union, the Shift+Tab
 * cycle, the startup flags, the plan policy list, the status bar - so each is read from
 * that source here. The direction that matters for a safety page is the one that could
 * silently widen what plan mode permits: `docsOnly` and `readOnlyOnly` are asserted both
 * ways, so dropping either from the policy list without changing the page reddens.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "modes.md");
const TYPES = path.join(here, "types.ts");
const POLICIES = path.join(here, "defaultPolicies.ts");
const COMPOSER = path.join(packageRoot, "src", "ui", "UserInput.tsx");
const STATUS_BAR = path.join(
  packageRoot,
  "src",
  "ui",
  "components",
  "BottomStatusBar.tsx",
);
const FLAGS = path.join(packageRoot, "src", "config", "sharedOptions.ts");
const VALIDATOR = path.join(packageRoot, "src", "config", "flagValidator.ts");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function declaredModes(): string[] {
  const match = read(TYPES).match(/export type PermissionMode = ([^;]+);/);
  if (!match)
    throw new Error("the mode union moved; this guard must move with it");
  return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).filter(Boolean);
}

function cycleOrder(): string[] {
  const match = read(COMPOSER).match(
    /const modes: PermissionMode\[\] = \[([^\]]+)\]/,
  );
  if (!match)
    throw new Error("the cycle order moved; this guard must move with it");
  return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).filter(Boolean);
}

function planPolicies(): string {
  const source = read(POLICIES);
  const start = source.indexOf("PLAN_MODE_POLICIES");
  const end = source.indexOf("AUTO_MODE_POLICIES", start);
  if (start < 0 || end < 0) {
    throw new Error("the plan policy list moved; this guard must move with it");
  }
  return source.slice(start, end);
}

describe("spec/modes.md agrees with the permission sources", () => {
  const doc = read(DOC);

  it("reads a page and a source that really declare modes", () => {
    // Floors: an empty extraction must not agree with an empty page.
    expect(doc.length).toBeGreaterThan(500);
    expect(declaredModes().length).toBeGreaterThanOrEqual(3);
    expect(cycleOrder().length).toBeGreaterThanOrEqual(3);
  });

  it("names every declared mode as its own section", () => {
    for (const mode of declaredModes()) {
      expect(doc).toMatch(new RegExp(`^#{2,3} \`${mode}\``, "m"));
    }
  });

  it("states the cycle the composer implements", () => {
    const cycle = cycleOrder();
    expect(doc).toContain(`${cycle.join(" → ")} → ${cycle[0]}`);
  });

  it("documents every mode flag the CLI accepts", () => {
    const flags = [
      ...new Set(
        [...read(FLAGS).matchAll(/"(--(?:readonly|auto|mode))[\s<"]/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    expect(flags.length).toBeGreaterThanOrEqual(3);
    expect(flags.filter((flag) => !doc.includes(flag))).toEqual([]);
  });

  it("claims documentation writes only while plan mode allows them", () => {
    expect(/docsOnly: true/.test(planPolicies())).toBe(
      /documentation/i.test(doc),
    );
  });

  it("claims non-writing shell commands only while plan mode checks them", () => {
    expect(/readOnlyOnly: true/.test(planPolicies())).toBe(
      /non-writing/i.test(doc),
    );
  });

  it("warns about the wildcard allow while plan mode grants it", () => {
    const grantsWildcard = /tool: "\*", permission: "allow"/.test(
      planPolicies(),
    );
    expect(/MCP/.test(doc)).toBe(grantsWildcard);
  });

  it("claims the workspace name stays visible only while the status bar shows it", () => {
    expect(/workspace name/i.test(doc)).toBe(
      /key="workspace"/.test(read(STATUS_BAR)),
    );
  });

  it("explains the override refusal the validator performs", () => {
    expect(/PERMISSION_FLAGS_IGNORED_BY_MODE/.test(doc)).toBe(
      /PERMISSION_FLAGS_IGNORED_BY_MODE/.test(read(VALIDATOR)),
    );
  });

  it("does not revive the upstream `normal` mode or the hidden directory", () => {
    expect(doc).not.toContain("`normal`");
    expect(doc).not.toMatch(/Hidden to save space/i);
  });
});
