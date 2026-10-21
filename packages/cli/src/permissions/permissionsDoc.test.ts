import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/permissions.md` is the page a user reads to decide what the CLI may do without
 * asking. It carried the upstream continue CLI's shape: a `normal` mode, argument globs
 * on every tool, `write_file`/`run_terminal_command` tool names, and a headless section
 * claiming that writes require confirmation and the run exits when one is needed. The
 * measured headless default now keeps that promise from the other side: ask tools are
 * dropped from a headless request and a call that reaches approval is refused, so the
 * page has to say that `--allow` is the way in rather than promise an automatic allow.
 *
 * Each claim is read back from the source that keeps it, and the safety-relevant ones
 * (headless defaults, exclude -> disabled, plan/auto replacing the list) are asserted in
 * both directions so a source change and a page change have to travel together.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "permissions.md");
const TYPES = path.join(here, "types.ts");
const POLICIES = path.join(here, "defaultPolicies.ts");
const RESOLVER = path.join(here, "precedenceResolver.ts");
const CHECKER = path.join(here, "permissionChecker.ts");
const SERVICE = path.join(
  packageRoot,
  "src",
  "services",
  "ToolPermissionService.ts",
);

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function declared(type: string): string[] {
  const match = read(TYPES).match(
    new RegExp(`export type ${type}\\s*=\\s*([^;]+);`),
  );
  if (!match)
    throw new Error(`the ${type} union moved; this guard must move with it`);
  return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).filter(Boolean);
}

/** The layer labels the page uses, in the order the resolver applies them. */
const LAYERS: Record<string, string> = {
  commandLineFlags: "Command-line flags",
  loadPermissionPoliciesFromSettings: "settings.json",
  getDefaultToolPolicies: "Default policies",
};

function resolverOrder(): string[] {
  const source = read(RESOLVER);
  const body = source.slice(
    source.indexOf("export function resolvePermissionPrecedence"),
  );
  return Object.keys(LAYERS)
    .map((name) => ({ name, at: body.indexOf(name) }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.name);
}

describe("spec/permissions.md agrees with the permission sources", () => {
  const doc = read(DOC);

  it("reads a page and unions that really declare permissions", () => {
    expect(doc.length).toBeGreaterThan(1_200);
    expect(declared("PermissionPolicy").length).toBeGreaterThanOrEqual(3);
    expect(declared("PermissionMode").length).toBeGreaterThanOrEqual(3);
  });

  it("names every permission and every mode, and no retired mode", () => {
    for (const permission of declared("PermissionPolicy")) {
      expect(doc).toContain(`\`${permission}\``);
    }
    for (const mode of declared("PermissionMode")) {
      expect(doc).toContain(`\`${mode}\``);
    }
    expect(doc).not.toContain("`normal`");
  });

  it("lists the sources in the order the resolver applies them", () => {
    const order = resolverOrder();
    expect(order.length).toBe(3);
    expect(order.map((name) => LAYERS[name]).every(Boolean)).toBe(true);

    const positions = order.map((name) => doc.indexOf(LAYERS[name]));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("claims headless default-denies writes only while the defaults do", () => {
    // The same ask table serves both modes; a headless run drops ask tools and
    // refuses a call that reaches approval, so the page must not promise an
    // automatic allow. Silence about the mode would hide a refusal.
    const defaultDenies = /const writePermission = "ask"/.test(read(POLICIES));
    expect(/Headless runs cannot answer an `ask`/.test(doc)).toBe(
      defaultDenies,
    );
  });

  it("calls excluded tools disabled while core maps them there", () => {
    const disables = /case "exclude":\s*return "disabled"/.test(read(CHECKER));
    expect(doc.includes("disabled")).toBe(disables);
  });

  it("promises first-match-wins only while the checker breaks on the first match", () => {
    const firstWins = /FIRST matching policy wins/.test(read(CHECKER));
    expect(/first matching policy wins/i.test(doc)).toBe(firstWins);
  });

  it("stops consulting the layers in plan and auto while the service replaces them", () => {
    const replaces =
      /newMode === "plan" \|\| newMode === "bypassPermissions"/.test(
        read(SERVICE),
      );
    expect(/do not consult/i.test(doc)).toBe(replaces);
  });

  it("states the flag order the resolver pushes", () => {
    const source = read(RESOLVER);
    const start = source.indexOf("function commandLineFlagsToPolicies");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start);
    const exclude = body.indexOf("flags.exclude");
    const ask = body.indexOf("flags.ask");
    const allow = body.indexOf("flags.allow");
    expect(exclude).toBeGreaterThanOrEqual(0);
    expect(exclude).toBeLessThan(ask);
    expect(ask).toBeLessThan(allow);
    expect(doc.replace(/\s+/g, " ")).toMatch(
      /`--exclude` is pushed before `--ask` before `--allow`/,
    );
  });

  it("does not revive upstream tool names or the secure-headless claim", () => {
    for (const stale of ["write_file", "run_terminal_command", "Read(*)"]) {
      expect(doc).not.toContain(stale);
    }
    expect(doc).not.toMatch(/secure by default/i);
  });
});
