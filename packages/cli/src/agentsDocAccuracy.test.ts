import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `AGENTS.md` is the document every coding agent reads before it reads the
 * architecture notes, and it tells them what to run: `npm run build`, `npm run lint`,
 * where the entry points live, which file implements the hook runner. Nothing checked
 * any of it, so the drift already in the file ("roughly 200 files" against 335 test
 * files on disk) survives and shapes what the next agent believes about the package.
 *
 * So its checkable statements are run rather than trusted, the same way
 * `docsAccuracy.test.ts` runs the architecture notes' path claim. Two things make this
 * file different: its paths are written **relative to the directory heading above
 * them** (`HookService.ts` under `src/hooks/`), so a mention is resolved against the
 * nearest preceding directory rather than only against the package root, and its
 * commands are claims about `package.json`, which is where a wrong one costs an agent
 * a failed command instead of a stale sentence.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const DOC = path.join(packageRoot, "AGENTS.md");
const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
) as { scripts?: Record<string, string> };

/**
 * npm's own verbs, which never appear in `scripts`. Anything else the document tells a
 * reader to run has to be a script this package declares.
 */
const NPM_BUILT_INS = ["install", "ci", "test", "start", "run"];

/**
 * Locations the document describes rather than ships: settings files in a user's own
 * tree, and the naming convention a suite must follow. An entry leaves this list only
 * by becoming a file of this package.
 */
const EXTERNAL_MENTIONS: string[] = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".tnt/settings.json",
  ".tnt/settings.local.json",
  ".test.ts",
];

/**
 * What `npm run build` produces: the document may name it, but a fresh clone does
 * not have it and neither a missing nor a present bundle is a claim about sources.
 */
const GENERATED_DIRS: string[] = ["dist/"];

const SEPARATED_PATH =
  /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.(?:ts|tsx|js|jsx|mjs|json|md|ya?ml))`/g;
const BARE_FILE = /`([A-Za-z0-9_.@-]+\.(?:ts|tsx|js|jsx|mjs|json|md|ya?ml))`/g;
const DIRECTORY = /`([A-Za-z0-9_.@/-]+\/)`/g;
const NPM_COMMAND = /npm (?:run )?([A-Za-z][\w:-]*)/g;

interface Mention {
  text: string;
  /** The nearest directory heading above it, which is how the file is written. */
  context: string | undefined;
}

/**
 * Walks the document once, carrying the most recent directory mention, so a bare
 * filename is checked where the reader would actually look for it.
 */
function scan(): { separated: string[]; bare: Mention[]; dirs: string[] } {
  const lines = fs.readFileSync(DOC, "utf-8").split("\n");
  const separated: string[] = [];
  const bare: Mention[] = [];
  const dirs: string[] = [];

  let nearest: string | undefined;
  for (const line of lines) {
    for (const match of line.matchAll(DIRECTORY)) {
      nearest = match[1];
      if (GENERATED_DIRS.includes(match[1])) {
        continue;
      }
      if (!dirs.includes(match[1])) dirs.push(match[1]);
    }
    for (const match of line.matchAll(SEPARATED_PATH)) {
      // The settings locations live in the reader's own tree, not in this package.
      if (EXTERNAL_MENTIONS.includes(match[1])) {
        continue;
      }
      if (!separated.includes(match[1])) separated.push(match[1]);
    }
    for (const match of line.matchAll(BARE_FILE)) {
      if (!EXTERNAL_MENTIONS.includes(match[1])) {
        bare.push({ text: match[1], context: nearest });
      }
    }
  }
  return { separated, bare, dirs };
}

function insidePackage(candidate: string, base: string): string | undefined {
  const full = path.resolve(base, candidate);
  if (!full.startsWith(packageRoot)) {
    return undefined;
  }
  const parts = full.split(path.sep);
  if (parts.includes("node_modules") || parts.includes("dist")) {
    return undefined;
  }
  return full;
}

function resolvesDir(candidate: string, everyDir: string[]): boolean {
  // The table writes `src/ui/commands/` once and then names `loaders/` in a bullet
  // under it, so a directory is tried bare, under `src/`, and inside every other
  // directory the document mentions.
  const raw = candidate.replace(/^\.?\//, "");
  const bases = [
    candidate,
    `src/${raw}`,
    ...everyDir.map((dir) => `${dir.replace(/\/$/, "")}/${raw}`),
  ].map((dir) => path.resolve(packageRoot, dir));
  return bases.some((full) => {
    if (!full.startsWith(packageRoot)) {
      return false;
    }
    const parts = full.split(path.sep);
    if (parts.includes("node_modules") || parts.includes("dist")) {
      return false;
    }
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  });
}

function resolvesFile(
  candidate: string,
  context: string | undefined,
  everyDir: string[],
): boolean {
  // The file names its directories with, so every one of them is a candidate base:
  // the Module Layout table writes `utils/` and `stream/` in the first cell and the
  // file in the prose of the same row, so a single "nearest heading above" rule
  // would attribute `logger.ts` to whichever `src/.../` was mentioned last. The
  // table's directories are written below `src/`, which the prose leaves implicit,
  // so each is tried both ways.
  const bases = [
    ...(context ? [context] : []),
    ...everyDir,
    ...everyDir.map((dir) => `src/${dir.replace(/^\.?\//, "")}`),
    "src",
    ".",
  ].map((dir) => path.resolve(packageRoot, dir));
  return bases.some((base) => {
    const full = insidePackage(candidate, base);
    return (
      full !== undefined && fs.existsSync(full) && fs.statSync(full).isFile()
    );
  });
}

describe("the agent-facing document says what this package really does", () => {
  const { separated, bare, dirs } = scan();

  it("reads a document that carries the claims it is meant to check", () => {
    // Without this, a moved file or a broken pattern would report a clean document.
    expect(fs.existsSync(DOC), DOC).toBe(true);
    expect(separated.length + bare.length + dirs.length).toBeGreaterThan(25);
  });

  it("names only commands this package declares", () => {
    const scripts = Object.keys(PACKAGE_JSON.scripts ?? {});
    const commands = [
      ...new Set(
        [...fs.readFileSync(DOC, "utf-8").matchAll(NPM_COMMAND)].map(
          (m) => m[1],
        ),
      ),
    ];

    // The floor is the point of the case: a document whose commands cannot be
    // collected would agree with any package.json.
    expect(commands.length).toBeGreaterThan(5);
    expect(
      commands.filter(
        (c) => !NPM_BUILT_INS.includes(c) && !scripts.includes(c),
      ),
    ).toEqual([]);
  });

  it("resolves every directory it names", () => {
    expect(dirs.filter((d) => !resolvesDir(d, dirs))).toEqual([]);
  });

  it("resolves every path with a directory in it", () => {
    expect(separated.filter((p) => !resolvesFile(p, undefined, dirs))).toEqual(
      [],
    );
  });

  it("resolves every bare filename against the headings around it", () => {
    // One case per kind: a single case would stop at its first offender list and
    // leave the reader guessing whether the other kinds were checked at all.
    expect(bare.filter((m) => !resolvesFile(m.text, m.context, dirs))).toEqual(
      [],
    );
  });

  it("keeps every named external mention in the document", () => {
    const text = fs.readFileSync(DOC, "utf-8");
    for (const entry of [...EXTERNAL_MENTIONS, ...GENERATED_DIRS]) {
      expect(text.includes(entry), entry).toBe(true);
    }
  });

  it("counts its suite with a command, not with a saved number", () => {
    const text = fs.readFileSync(DOC, "utf-8");

    // "roughly 200 files" was wrong by 67 % the day it was read: the number described
    // one tree and no command could refresh it. A document that states a size has to
    // state the command that produces it, so the next reader can re-measure.
    const sizes = [...text.matchAll(/(\d[\d,]*)\s+(?:test files|files)/gi)];
    for (const size of sizes) {
      expect(text, size[0]).toContain("find src");
    }
  });
});
