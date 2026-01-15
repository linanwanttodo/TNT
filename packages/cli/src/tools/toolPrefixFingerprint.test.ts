import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import {
  LIST_SUBAGENTS_TOOL_META,
  SUBAGENT_TOOL_META,
} from "../subagent/index.js";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import { SKILLS_TOOL_META } from "./skills.js";
import { sortToolsByName } from "./stableOrder.js";

/**
 * Tool definitions are billed as part of the cached prompt prefix, so a wording
 * change in one description is not a copy edit: it cold-starts the first request
 * of every new session. `toolGuidance.test.ts` holds the working rules that must
 * stay in that text; this guard holds the whole of it.
 *
 * The digest covers every built-in tool the engine can put in a request, in the
 * order `sortToolsByName` puts them, which is the order the prefix is billed in.
 * That surface is wider than the registry copy: `src/tools/index.tsx` composes the
 * request from its own arrays, and these four are declared there rather than in
 * `ALL_BUILT_IN_TOOLS`. They were outside the digest, so rewording the Glob or
 * plan-mode description broke the cache for every session that carries them while
 * this guard stayed green.
 *
 * The frozen values below are also written into `ARCHITECTURE-tnt.md`, and that
 * file is read as text here. So an intentional prefix change cannot be committed
 * without also putting a line about it where the next reader - and the cache-break
 * report's attribution - will find it.
 */
const PREFIX_FINGERPRINT = "fddd0b7c530ef75f";
const PREFIX_CHARACTERS = 22_590;
const PREFIX_TOOLS = 30;

const ARCHITECTURE_DOC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../ARCHITECTURE-tnt.md",
);

function builtInToolPrefix(): { text: string; names: string[] } {
  const all = [...ALL_BUILT_IN_TOOLS];
  const ordered = sortToolsByName(all);
  return {
    names: ordered.map((tool) => tool.name),
    text: ordered
      .map(
        (tool) =>
          `${tool.name}\u0000${tool.description ?? ""}\u0000${JSON.stringify(
            tool.parameters ?? null,
          )}`,
      )
      .join("\u0001"),
  };
}

function fingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

describe("the tool list as billed prefix", () => {
  it("has not moved from the digest this file and the architecture doc name", () => {
    const { text } = builtInToolPrefix();

    // Red here means the billed prefix changed. Update the digest, the two
    // numbers and the doc line together, and say in the commit what it costs.
    expect(fingerprintOf(text)).toBe(PREFIX_FINGERPRINT);
    expect(text.length).toBe(PREFIX_CHARACTERS);
  });

  it("records the same fingerprint in the architecture doc", () => {
    const doc = readFileSync(ARCHITECTURE_DOC, "utf-8");

    expect(doc).toContain(PREFIX_FINGERPRINT);
    expect(doc).toContain(`over ${PREFIX_TOOLS} tools`);
    expect(doc).toContain(`${PREFIX_CHARACTERS} characters`);
  });

  it("orders the list as a pure function of the names, not of registration", () => {
    const { names } = builtInToolPrefix();
    // Same comparison the shipped order uses: UTF-16 code units, never a locale.
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    // The whole point of sorting is that the prefix does not depend on how the
    // list was assembled; if this drifts, the digest is machine-dependent.
    expect(names).toEqual(sorted);
    expect(new Set(names).size).toBe(names.length);
  });

  it("digests the static text of the tools whose live form is generated", () => {
    // Subagent and Skills descriptions grow a list of whatever the session has
    // installed, so the request would carry different bytes on different machines
    // if `allBuiltIns` handed over the generated tools instead of these constants.
    const byName = new Map(
      sortToolsByName([...ALL_BUILT_IN_TOOLS]).map((tool) => [tool.name, tool]),
    );

    expect(byName.get("Subagent")?.description).toBe(
      SUBAGENT_TOOL_META.description,
    );
    expect(byName.get("Skills")?.description).toBe(
      SKILLS_TOOL_META.description,
    );
    expect(byName.get("ListSubagents")?.description).toBe(
      LIST_SUBAGENTS_TOOL_META.description,
    );
  });

  it("reads the tool list it is digesting", () => {
    const { names } = builtInToolPrefix();

    // A scan that found nothing would agree with any digest.
    expect(names.length).toBe(PREFIX_TOOLS);
    expect(names.length).toBeGreaterThan(20);
    for (const name of ["Read", "Edit", "Write", "Bash", "Search"]) {
      expect(names).toContain(name);
    }
  });

  it("digests the registry itself, which now holds every built-in tool", () => {
    // The four tools this file used to append beside the registry were moved into
    // `allBuiltIns`, so the list a request assembles and the list this digest reads
    // are the same array; the discovery case below refuses an exported tool the
    // digest does not reach.
    expect(ALL_BUILT_IN_TOOLS.length).toBe(PREFIX_TOOLS);
    const { names } = builtInToolPrefix();
    for (const name of [
      "CheckBackgroundJob",
      "EnterPlanMode",
      "ExitPlanMode",
      "Glob",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("refuses a built-in tool whose declaration the digest does not reach", () => {
    // Every tool this package declares is billed to the prefix in the sessions
    // that carry it, so a new `Tool` export has to enter the digest too. Read the
    // values rather than the text: `todo.ts` names itself through a constant, so
    // a source scan would have to hand-copied the very list this case checks.
    // The cast is the whole cost of using Vite's glob here: the type gate does not
    // load `vite/client` ambient types, while the runner that executes this file
    // supplies `import.meta.glob` itself.
    const discovered = Object.values(
      (
        import.meta as unknown as {
          glob(
            patterns: string[],
            options: { eager: true },
          ): Record<string, Record<string, unknown>>;
        }
      ).glob(["./*.ts", "!./**/*.test.ts"], { eager: true }),
    )
      .flatMap((module) =>
        Object.values(module).filter(
          (value): value is { name: string } =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as { name?: unknown }).name === "string" &&
            (typeof (value as { description?: unknown }).description ===
              "string" ||
              typeof (value as { parameters?: unknown }).parameters ===
                "object"),
        ),
      )
      .map((tool) => tool.name);

    // Subagent and Skills metadata is contributed from `src/subagent`, and
    // `uploadArtifact`/`status` reach the request behind the `--id` flag; the
    // floor is the measured count of built-in tools in this directory.
    expect(discovered.length).toBeGreaterThan(25);

    const { names } = builtInToolPrefix();
    expect(discovered.filter((name) => !names.includes(name))).toEqual([]);
  });
});
