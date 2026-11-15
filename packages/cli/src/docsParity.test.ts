import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The documentation site is published twice from one tree: `docs/` and
 * `docs/zh/`. A page that exists on one side only is not a build error - the
 * other site simply renders a nav without it - so nothing notices when a round
 * translates one page and forgets its sibling. Two pages sat in that state until
 * 2026-10-28 (`troubleshooting`, `reference`).
 *
 * `snippets/` is the deliberate exception: both sites import the same fragment,
 * so a copy under `zh/` would be the second source this tree has been removing.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const docsRoot = path.resolve(packageRoot, "..", "..", "docs");
const zhRoot = path.join(docsRoot, "zh");

/** Every page under `docs/`, as a forward-slash slug relative to it. */
function pages(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".mdx")) {
        found.push(
          path
            .relative(docsRoot, full)
            .split(path.sep)
            .join("/")
            .replace(/\.mdx$/, ""),
        );
      }
    }
  };
  walk(dir);
  return found;
}

function nav(file: string): string {
  return fs.readFileSync(path.join(docsRoot, file), "utf-8");
}

const all = pages(docsRoot);
const english = all.filter(
  (page) => !page.startsWith("zh/") && !page.startsWith("snippets/"),
);
const chinese = all
  .filter((page) => page.startsWith("zh/"))
  .map((page) => page.slice("zh/".length));

/** `index.mdx` is the site root and is not named in the nav. */
const leaf = (page: string): boolean => page !== "index";

describe("the two published documentation sites", () => {
  it("reads both page sets", () => {
    // A walk that finds nothing would make every comparison below pass, so the
    // counts are asserted first.
    expect(english.length).toBeGreaterThanOrEqual(20);
    expect(chinese.length).toBeGreaterThanOrEqual(20);
  });

  it("has a Chinese page for every English page", () => {
    expect(english.filter((page) => !chinese.includes(page))).toEqual([]);
  });

  it("has an English page for every Chinese page", () => {
    expect(chinese.filter((page) => !english.includes(page))).toEqual([]);
  });

  it("lists every page in its own site's navigation", () => {
    const englishNav = nav("docs.json");
    const chineseNav = nav("docs.zh.json");

    expect(
      english.filter(leaf).filter((page) => !englishNav.includes(`"${page}"`)),
    ).toEqual([]);
    expect(
      chinese.filter(leaf).filter((page) => !chineseNav.includes(`"${page}"`)),
    ).toEqual([]);
  });

  it("keeps the shared snippets shared", () => {
    expect(fs.existsSync(path.join(docsRoot, "snippets"))).toBe(true);
    // A translated copy would drift from the one both sites import.
    expect(fs.existsSync(path.join(zhRoot, "snippets"))).toBe(false);
  });
});
