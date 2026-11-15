import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The wall clock on a turn belongs to the headless run alone. In the TUI a person
 * is reading, approving or editing while the request is open, and in `tnt serve`
 * the session is kept alive by inactivity shutdown; a deadline armed in either
 * would cut off a turn for no reason anyone there could see.
 *
 * So the bound is guarded by where it is armed rather than by waiting out a
 * default: `armTimeout` may be called from one file only, and that file is the
 * headless command. The scan names the surfaces the ruling covers, so a guard
 * that silently stopped reading them cannot pass.
 */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SRC_ROOT = path.join(PACKAGE_ROOT, "src");

/** The file that defines `armTimeout`; its own declaration is not a call site. */
const DEFINITION = "src/commands/headlessTimeout.ts";
const SURFACES = [
  "src/commands/serve.ts",
  "src/commands/serve.helpers.ts",
  "src/ui/TUIChat.tsx",
  "src/ui/hooks/useChat.ts",
];

function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        found.push(...sourcesUnder(absolute));
      }
      continue;
    }
    if (
      !/\.(ts|tsx)$/.test(entry.name) ||
      /\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      continue;
    }
    found.push(path.relative(PACKAGE_ROOT, absolute).split(path.sep).join("/"));
  }
  return found.sort();
}

function armedBoundCallSites(): string[] {
  return sourcesUnder(SRC_ROOT).filter((relative) => {
    if (relative === DEFINITION) {
      return false;
    }
    const source = fs.readFileSync(path.join(PACKAGE_ROOT, relative), "utf-8");
    return /(?<![.\w])armTimeout\(/.test(source);
  });
}

describe("which surface may put a time limit on a turn", () => {
  it("arms the bound in the headless command and nowhere else", () => {
    expect(armedBoundCallSites()).toEqual(["src/commands/chat.ts"]);
  });

  it("reads the sources it is ruling on", () => {
    const sources = sourcesUnder(SRC_ROOT);

    // A guard that walked nothing would agree with any scope, so the walk and
    // each named surface have to be proven present before the scope means anything.
    expect(sources.length).toBeGreaterThan(300);
    expect(sources).toContain(DEFINITION);
    for (const surface of SURFACES) {
      expect(sources).toContain(surface);
    }
  });
});
