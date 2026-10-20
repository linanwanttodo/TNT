import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `docsAccuracy.test.ts` reads the two architecture notes and
 * `agentsDocAccuracy.test.ts` reads `AGENTS.md`. Between them, the package's other
 * sixteen documents - `BUILD.md`, the eleven files under `spec/`, the module
 * READMEs and the test-helper guide - named no guard at all. Measured on the tree
 * before this file existed, nine of their path references did not resolve:
 * `src/streamChatResponse.ts` (moved to `src/stream/`), `src/tools/index.ts` (it is
 * `.tsx`), `src/mcp.ts` (there is no such file), four references to the deleted
 * `src/test-utils/` location, and `BUILD.md` promising a `dist/cn.js` wrapper while
 * `build.mjs` writes `dist/tnt.js`. A reader following any of them ends up at a
 * missing file.
 *
 * So every remaining document is read here, and a path with a source extension in
 * one of them has to exist.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");

/**
 * Covered by their own guards, which also check things beyond paths (commands,
 * counts, digests) - and `CHANGELOG.md`, whose entries describe the tree as it was
 * at each release rather than the current one.
 */
const OWNED_DOCS = [
  "AGENTS.md",
  "ARCHITECTURE-tnt.md",
  path.join("docs", "ARCHITECTURE-tnt.md"),
  "CHANGELOG.md",
];

/**
 * What `npm run build` writes. Named so a fresh clone cannot fail the gate, and so
 * the list is only useful while the documents still mention each entry.
 */
const GENERATED_PATHS = ["dist/tnt.js", "dist/meta.json"];

const DOCUMENTED_PATH =
  /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@*-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml))`/g;

function markdownFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      markdownFiles(full, found);
    } else if (entry.name.endsWith(".md")) {
      found.push(path.relative(packageRoot, full));
    }
  }
  return found;
}

interface Offender {
  doc: string;
  target: string;
}

/**
 * Only an explicit `npm run <script>` counts: a bare `npm <word>` in prose is not an
 * instruction, and a first version of this scan measured four "unknown scripts" across
 * the module docs, all of them prose - `npm doesn't`, `npm i`, `npm publish`. `npm i`
 * and the rest are listed as verbs so a document that really does tell the reader to
 * run one is not refused for it.
 */
const RUN_COMMAND = /npm run ([A-Za-z][\w:-]*)/g;
const NPM_VERBS = [
  "ci",
  "exec",
  "i",
  "install",
  "link",
  "ls",
  "pack",
  "publish",
  "run",
  "start",
  "test",
];

function scanCommands(docs: string[]): {
  mentions: string[];
  offenders: Offender[];
} {
  const scripts = Object.keys(
    JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"))
      .scripts ?? {},
  ) as string[];
  const mentions: string[] = [];
  const offenders: Offender[] = [];
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(packageRoot, doc), "utf-8");
    for (const command of new Set(
      [...text.matchAll(RUN_COMMAND)].map((m) => m[1]),
    )) {
      mentions.push(command);
      if (!scripts.includes(command) && !NPM_VERBS.includes(command)) {
        offenders.push({ doc, target: command });
      }
    }
  }
  return { mentions, offenders };
}

function scan(): { docs: string[]; mentions: number; offenders: Offender[] } {
  const docs = markdownFiles(packageRoot).filter(
    (doc) => !OWNED_DOCS.includes(doc) && !GENERATED_PATHS.includes(doc),
  );
  const offenders: Offender[] = [];
  let mentions = 0;

  for (const doc of docs) {
    const text = fs.readFileSync(path.join(packageRoot, doc), "utf-8");
    const targets = [
      ...new Set([...text.matchAll(DOCUMENTED_PATH)].map((m) => m[1])),
    ];
    mentions += targets.length;
    for (const target of targets) {
      if (GENERATED_PATHS.includes(target)) {
        continue;
      }
      const bases = [
        packageRoot,
        path.join(packageRoot, path.dirname(doc)),
        path.join(packageRoot, "src"),
        repoRoot,
        path.join(repoRoot, "core"),
        path.join(repoRoot, "packages"),
      ];
      const hit = bases.some((base) => {
        const full = path.resolve(base, target);
        if (!full.startsWith(repoRoot)) {
          return false;
        }
        const parts = full.split(path.sep);
        if (parts.includes("node_modules") || parts.includes("dist")) {
          return false;
        }
        return fs.existsSync(full);
      });
      if (!hit) {
        offenders.push({ doc, target });
      }
    }
  }
  return { docs, mentions, offenders };
}

describe("the module documents name files that exist", () => {
  const { docs, mentions, offenders } = scan();
  const commands = scanCommands(docs);

  it("names only scripts this package declares", () => {
    // A document telling a reader to run `npm run build:snapshot` after the script is
    // renamed costs them a failed command, and the floor keeps a scan that collected
    // nothing from agreeing with any package.json.
    expect(commands.mentions.length).toBeGreaterThan(2);
    expect(commands.offenders).toEqual([]);
  });

  it("reads the documents it is meant to check", () => {
    // A scan of nothing - a moved directory, a broken walk - would agree with any
    // claim about the docs, so both the file count and the mention count are floored.
    expect(docs.length).toBeGreaterThan(12);
    expect(mentions).toBeGreaterThan(40);
  });

  it("resolves every path the module documents name", () => {
    expect(offenders).toEqual([]);
  });

  it("keeps every build output it excuses still documented", () => {
    const text = docs
      .map((doc) => fs.readFileSync(path.join(packageRoot, doc), "utf-8"))
      .join("\n");
    for (const entry of GENERATED_PATHS) {
      expect(text.includes(entry), entry).toBe(true);
    }
  });
});
