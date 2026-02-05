import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import {
  BUILTIN_SLASH_COMMANDS,
  REMOTE_MODE_SLASH_COMMANDS,
} from "./ui/commands/builtins.js";

/**
 * The slash-commands page is the only place a user learns what `/` can do, and
 * nothing compared it against the command table the composer builds. That is how
 * a row for `/config` outlived the command: the capability went away with the
 * hub, the row stayed, in both languages, and every gate stayed green because no
 * gate looked at it.
 *
 * Both directions are checked with no exceptions, so a command cannot be added
 * undocumented and a row cannot survive its command. The one name that is not a
 * built-in is `skills`, which arrives from the skills loader.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");

const PAGES = [
  path.join(repoRoot, "docs", "cli", "slash-commands.mdx"),
  path.join(repoRoot, "docs", "zh", "cli", "slash-commands.mdx"),
];

const DOCUMENTED_ROW = /^\|\s*`\/([a-z0-9-]+)`/gm;

/** Provided by a loader rather than by the built-in list. */
const LOADER_COMMANDS = ["skills"];

function builtInNames(): string[] {
  // The remote-mode trio is a separate array but the same composer surface:
  // RemoteCommandLoader adds it to every session.
  return [
    ...new Set(
      [...BUILTIN_SLASH_COMMANDS, ...REMOTE_MODE_SLASH_COMMANDS].map(
        (command) => command.name,
      ),
    ),
  ];
}

function documentedNames(page: string): string[] {
  const text = fs.readFileSync(page, "utf-8");
  return [...text.matchAll(DOCUMENTED_ROW)].map((match) => match[1]);
}

describe("the slash-commands pages match the real command list", () => {
  const builtIn = builtInNames();

  it("reads a command list that is really populated", () => {
    // Without this, an empty import or a dead pattern would satisfy both
    // directions below by matching nothing.
    expect(builtIn.length).toBeGreaterThanOrEqual(25);
    for (const page of PAGES) {
      expect(documentedNames(page).length).toBeGreaterThanOrEqual(30);
    }
  });

  it("documents only commands that exist", () => {
    const registered = new Set([...builtIn, ...LOADER_COMMANDS]);
    for (const page of PAGES) {
      const invented = documentedNames(page).filter(
        (name) => !registered.has(name),
      );
      expect(invented, path.relative(repoRoot, page)).toEqual([]);
    }
  });

  it("documents every built-in command in both languages", () => {
    for (const page of PAGES) {
      const documented = new Set(documentedNames(page));
      const missing = builtIn.filter((name) => !documented.has(name));
      expect(missing, path.relative(repoRoot, page)).toEqual([]);
    }
  });

  it("keeps the two languages on the same command list", () => {
    const [english, chinese] = PAGES.map((page) =>
      documentedNames(page).sort(),
    );
    expect(chinese).toEqual(english);
  });
});
