import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { t } from "../i18n/index.js";

import { KEY_BINDINGS, documentedKeys } from "./keyBindings.js";

/**
 * The table `/help` prints and the table a reader finds on the site are the same
 * promise, and they were two hand-written lists until now: the reasoning fold,
 * the background key and the queue shortcuts answered but were documented
 * nowhere, and the site listed keys the composer never bound.
 */
const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "docs",
);

/** Key cells only: `Ctrl+X` / `Ctrl+R`, one or more backticked alternatives. */
function tableKeys(markdown: string): string[] {
  const found: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*(`[^`|]+`(?:\s*\/\s*`[^`|]+`)*)\s*\|/.exec(line);
    if (!match) {
      continue;
    }
    for (const cell of match[1].split("/")) {
      found.push(cell.replace(/`/g, "").trim());
    }
  }
  return found.sort();
}

describe("the keyboard table", () => {
  it("has a translated line for every binding", () => {
    // A floor: an emptied table would satisfy every comparison below.
    expect(KEY_BINDINGS.length).toBeGreaterThanOrEqual(15);
    for (const { keys, descriptionKey } of KEY_BINDINGS) {
      expect(t(descriptionKey), keys).not.toBe(descriptionKey);
    }
  });

  it("is the same set on both documentation pages", () => {
    const expected = documentedKeys().sort();
    for (const page of [
      path.join(docsRoot, "cli", "tui.mdx"),
      path.join(docsRoot, "zh", "cli", "tui.mdx"),
    ]) {
      const listed = tableKeys(fs.readFileSync(page, "utf-8"));
      expect(listed, path.basename(path.dirname(page)) + "/tui.mdx").toEqual(
        expected,
      );
    }
  });
});
