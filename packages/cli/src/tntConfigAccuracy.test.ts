import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `.tnt/` is read by the engine itself - rules and skills join the system
 * message, `agents/` and `checks/` feed `tnt review`, prompts are invokable -
 * so a stale sentence in it is a bug that ships to every session. Nothing in
 * the gate set noticed: these files are not build inputs, and the last round
 * found them describing deleted surfaces, the old command name, and an
 * instruction to stamp generated code with the previous product's name.
 *
 * Two directions are pinned. A path or command a file names must resolve, and a
 * surface this repository removed must stay removed. Both are only meaningful if
 * the scan really finds claims, so the counts are floored first - a broken
 * pattern would otherwise report a clean tree.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..", "..");
const configRoot = path.join(repoRoot, ".tnt");

const GROUPS = ["rules", "agents", "checks", "prompts"];

/** Whichever directory a claim reads closest to, in the order that matches. */
const ROOTS = [
  repoRoot,
  path.join(repoRoot, "core"),
  path.join(repoRoot, "packages"),
  path.join(repoRoot, "packages", "config-yaml", "src"),
  path.join(repoRoot, "packages", "cli", "src"),
  path.join(repoRoot, ".github"),
  path.join(repoRoot, "scripts"),
  path.join(repoRoot, "docs"),
];

const BACKTICK = /`([^`\n]+)`/g;

/**
 * A claim is a slash-bearing token that ends in a source extension or a trailing
 * slash: the file-and-directory assertions. Everything else in backticks -
 * versions, identifiers, URLs, config keys written without a path - decides
 * nothing here.
 */
const PATH_CLAIM =
  /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+(?:\/|\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|ya?ml|sh|ps1|prompt))?$/;

/** A glob, a placeholder, a home path or a scheme is an instruction, not a name. */
const NOT_A_NAME = /[$<{*~ ]|:\/\/|\.\.\./;

/** A scoped npm package name (`@tnt/llm-info`) is not a path in this tree. */
const PACKAGE_NAME = /^@/;

/** A host with a path (`github.com/owner/repo`) is an address, not a file. */
const HOST_PATH = /^(?:[\w-]+\.)+(?:com|dev|io|org|net)\//;

/**
 * Names and surfaces this repository no longer has. Each entry was chosen
 * because the tree used to carry it and an agent reading one of these files
 * would act on it: the old product name, its home directory, its command, and
 * the editor layer that was deleted.
 */
const BANNED: { label: string; re: RegExp }[] = [
  { label: "the previous product name", re: /\bContinue\b/ },
  { label: "the previous home directory", re: /~\/\.continue/ },
  { label: "the previous project directory", re: /\.continue\// },
  { label: "the previous command", re: /\bcn\s+-[pm]/ },
  { label: "the deleted editor tree", re: /\bide\/(?:vscode|gui|intellij)\b/ },
  {
    label: "an editor surface",
    re: /\b(?:VS ?Code|JetBrains|IntelliJ|webview)\b/,
  },
  {
    label: "another agent product",
    re: /\b(?:Cursor|Claude Code|OpenCode|opencode)\b/,
  },
];

/** Places removed on purpose; a claim of their absence must keep holding. */
const REMOVED_PLACES = ["ide"];

/**
 * The rewritten dev-data rule states that no CLI code emits dev data. That is a
 * claim about this package, so it is checked instead of trusted: the day someone
 * wires a `DataLogger` call in here, the rule has to be rewritten with it.
 */
const CLI_DEV_DATA = /DataLogger|dev_data|devData/;

function configFiles(): string[] {
  const found: string[] = [];
  for (const group of GROUPS) {
    const dir = path.join(configRoot, group);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isFile()) {
        found.push(full);
      }
    }
  }
  return found;
}

function resolves(candidate: string): boolean {
  return ROOTS.some((root) => {
    const full = path.resolve(root, candidate);
    return full.startsWith(repoRoot) && fs.existsSync(full);
  });
}

function collect(): {
  files: string[];
  pathClaims: Map<string, string>;
  bannedHits: string[];
  commands: { dir: string; script: string }[];
} {
  const files = configFiles();
  const pathClaims = new Map<string, string>();
  const bannedHits: string[] = [];
  const commands: { dir: string; script: string }[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const label = path.relative(repoRoot, file);

    for (const match of text.matchAll(BACKTICK)) {
      const token = match[1].trim();
      if (
        !PATH_CLAIM.test(token) ||
        NOT_A_NAME.test(token) ||
        PACKAGE_NAME.test(token) ||
        HOST_PATH.test(token) ||
        token.startsWith("/")
      ) {
        continue;
      }
      if (!pathClaims.has(token)) {
        pathClaims.set(token, label);
      }
    }

    for (const entry of BANNED) {
      if (entry.re.test(text)) {
        bannedHits.push(`${label}: ${entry.label}`);
      }
    }

    for (const line of text.split("\n")) {
      for (const match of line.matchAll(
        /cd\s+([A-Za-z0-9_.\/-]+)\s*&&\s*npm run ([A-Za-z0-9:_-]+)/g,
      )) {
        commands.push({ dir: match[1], script: match[2] });
      }
    }
  }

  return { files, pathClaims, bannedHits, commands };
}

function scriptsOf(dir: string): Set<string> | null {
  const manifest = path.join(repoRoot, dir, "package.json");
  if (!fs.existsSync(manifest)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return new Set(Object.keys(parsed.scripts ?? {}));
}

function cliSources(): string[] {
  const out: string[] = [];
  const skip = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".mimosa",
    ".zcode",
    ".vitest",
  ]);
  // This file quotes the very identifiers it looks for, so it cannot be evidence.
  const self = fileURLToPath(import.meta.url);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }
      const full = path.join(dir, entry.name);
      if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && full !== self) {
        out.push(full);
      }
    }
  };
  walk(packageRoot);
  return out;
}

describe("the .tnt configuration files describe this repository", () => {
  const { files, pathClaims, bannedHits, commands } = collect();
  const offenders = [...pathClaims.keys()].filter((c) => !resolves(c));

  it("reads files that really carry the claims it is meant to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(pathClaims.size).toBeGreaterThanOrEqual(15);
    expect(commands.length).toBeGreaterThanOrEqual(3);
  });

  it("names only paths that exist", () => {
    expect(offenders.map((c) => `${c} (${pathClaims.get(c)})`)).toEqual([]);
  });

  it("keeps every removed surface removed", () => {
    for (const place of REMOVED_PLACES) {
      expect(
        fs.existsSync(path.join(repoRoot, place)),
        `${place} should not exist`,
      ).toBe(false);
    }
  });

  it("uses only this product's names and surfaces", () => {
    expect(bannedHits).toEqual([]);
  });

  it("runs only commands the directory it names declares", () => {
    const bad = commands.filter(({ dir, script }) => {
      const scripts = scriptsOf(dir);
      return scripts === null || !scripts.has(script);
    });
    expect(bad.map(({ dir, script }) => `${dir}:${script}`)).toEqual([]);
  });

  it("keeps dev data out of the CLI, as the dev-data rule claims", () => {
    const hits = cliSources().filter((file) =>
      CLI_DEV_DATA.test(fs.readFileSync(file, "utf8")),
    );
    expect(hits.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
});
