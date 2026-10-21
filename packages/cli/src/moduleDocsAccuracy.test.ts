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

/**
 * A markdown link is what a reader clicks, and it is a different claim from a
 * backticked path: `spec/testing-strategies.md` points at helper files with
 * `[label](../test-utils/x.ts)`, so a move breaks the navigation while the path scan
 * above never sees the target at all. Every document is read here, including the ones
 * with their own path guard, and including `CHANGELOG.md` - a historical entry that
 * links a moved file is still a dead click.
 */
const LINK_TARGET =
  /\]\(([^)\s#]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml))\)/g;

function scanLinks(allDocs: string[]): {
  mentions: number;
  offenders: Offender[];
} {
  const offenders: Offender[] = [];
  let mentions = 0;
  for (const doc of allDocs) {
    const text = fs.readFileSync(path.join(packageRoot, doc), "utf-8");
    for (const target of new Set(
      [...text.matchAll(LINK_TARGET)].map((m) => m[1]),
    )) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        continue; // a scheme (http, file, slug) is not a path in this repository
      }
      mentions += 1;
      const full = path.resolve(packageRoot, path.dirname(doc), target);
      if (!full.startsWith(repoRoot) || !fs.existsSync(full)) {
        offenders.push({ doc, target });
      }
    }
  }
  return { mentions, offenders };
}

describe("the module documents name files that exist", () => {
  const { docs, mentions, offenders } = scan();
  const commands = scanCommands(docs);
  const links = scanLinks(markdownFiles(packageRoot));

  it("indexes every specification file", () => {
    // A spec nobody links is a spec no reader or agent finds, and the directory is the
    // surface that knows - the index cannot agree with a list someone keeps by hand.
    const specs = fs
      .readdirSync(path.join(packageRoot, "spec"))
      .filter((f) => f.endsWith(".md") && f !== "index.md")
      .sort();
    const index = fs.readFileSync(
      path.join(packageRoot, "spec", "index.md"),
      "utf-8",
    );
    const linked = new Set(
      [...index.matchAll(/\]\(\.\/([A-Za-z0-9_-]+\.md)\)/g)].map((m) => m[1]),
    );

    expect(specs.length).toBeGreaterThan(8);
    expect(specs.filter((f) => !linked.has(f))).toEqual([]);
  });

  it("carries no character that was already lost when the file was read", () => {
    // A U+FFFD in a committed document means the bytes arrived as something else: the
    // heading of `spec/wire-format.md` carried one where an arrow used to be, and the
    // only trace of the original is the replacement character itself.
    const broken = markdownFiles(packageRoot)
      .filter((doc) =>
        fs
          .readFileSync(path.join(packageRoot, doc), "utf-8")
          .includes("\uFFFD"),
      )
      .sort();
    expect(broken).toEqual([]);
  });

  it("links only files that exist", () => {
    // 29 link targets existed on the tree this case was written on; the floor sits
    // below that so a narrowed scan cannot pass by collecting nothing.
    expect(links.mentions).toBeGreaterThan(20);
    expect(links.offenders).toEqual([]);
  });

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
    // 40 mentions measured after `spec/otlp-metrics.md` was rewritten down from an
    // aspirational catalogue; the floor sits below that, matching the link scan, so a
    // moved directory or broken walk still cannot pass by collecting nothing.
    expect(mentions).toBeGreaterThan(20);
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
