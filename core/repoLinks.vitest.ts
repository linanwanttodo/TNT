import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * A repository link in the source is clicked by users: the Jira refusal tells them where the
 * configuration reference is, and the assistant and prompt scaffolds write links into their
 * workspace. Nine of these pointed at paths that do not exist (`docs/cli/models` instead of
 * `.mdx`, docs pages this repo never had), and nothing noticed until a scan did.
 *
 * Four of the dead links pointed at documentation this repository does not contain and one at
 * a section no page carries; they were removed rather than frozen, so the list below is empty
 * and any new dead link is a failure. The scanned-link count is floored because an empty walk
 * would otherwise agree with the empty list.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const SCANNED = ["core", "packages/cli"];

const KNOWN_DEAD: string[] = [];

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "__mocks__"].includes(entry.name))
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (
      /\.(ts|tsx|md)$/.test(entry.name) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".vitest.")
    ) {
      found.push(full);
    }
  }
  return found;
}

function deadRepoLinks(): { dead: string[]; total: number } {
  const dead: string[] = [];
  let total = 0;

  for (const root of SCANNED) {
    for (const file of sources(path.join(repoRoot, root))) {
      const source = fs.readFileSync(file, "utf-8");
      for (const match of source.matchAll(
        /github\.com\/linanwanttodo\/TNT\/(?:tree|blob)\/main\/([^`\s"')\\]+)/g,
      )) {
        total++;
        const target = match[1].split("#")[0];
        if (!fs.existsSync(path.join(repoRoot, target))) {
          dead.push(`${path.relative(repoRoot, file)} -> ${match[1]}`);
        }
      }
    }
  }

  return { dead, total };
}

describe("the repository links in the sources", () => {
  it("name paths that exist", () => {
    const { dead, total } = deadRepoLinks();

    expect(total).toBeGreaterThan(5);
    expect(dead.sort()).toEqual([...KNOWN_DEAD].sort());
  });
});
