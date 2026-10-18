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
 * The digest covers exactly what the engine contributes to a request for the
 * built-in tools - name, description and parameter schema, in the order
 * `sortToolsByName` puts them, which is the order the prefix is billed in.
 *
 * The frozen values below are also written into `ARCHITECTURE-tnt.md`, and that
 * file is read as text here. So an intentional prefix change cannot be committed
 * without also putting a line about it where the next reader - and the cache-break
 * report's attribution - will find it.
 */
const PREFIX_FINGERPRINT = "44f6665ae3049eab";
const PREFIX_CHARACTERS = 19_189;
const PREFIX_TOOLS = 25;

const ARCHITECTURE_DOC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../ARCHITECTURE-tnt.md",
);

function builtInToolPrefix(): { text: string; names: string[] } {
  const ordered = sortToolsByName([...ALL_BUILT_IN_TOOLS]);
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
});
