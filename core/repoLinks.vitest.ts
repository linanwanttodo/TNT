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
 * The five `KNOWN_DEAD` entries name documentation the repository does not contain, so they
 * cannot be repaired mechanically; whether they point at the external docs site or go away is
 * a docs-placement decision. They stay listed, with the equality assertion making the list the
 * release form: repairing or removing one means editing the list in the same commit.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const SCANNED = ["core", "packages/cli"];

const KNOWN_DEAD = [
  "core/config/types.ts -> docs/telemetry",
  "core/index.d.ts -> docs/telemetry",
  "core/config/util.ts -> docs/troubleshooting#i-received-a-codebase-indexing-disabled---your-linux-system-lacks-required-cpu-features-avx2-fma-notification",
  "core/config/validation.ts -> docs/features/tab-autocomplete#i-want-better-completions-should-i-use-gpt-4",
  "core/promptFiles/createNewPromptFile.ts -> docs/features/prompt-files",
];

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

function deadRepoLinks(): string[] {
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

  return dead;
}

describe("the repository links in the sources", () => {
  it("name paths that exist, except the five frozen docs decisions", () => {
    const dead = deadRepoLinks();

    // The floor is the frozen list itself: an empty scan cannot equal it.
    expect(dead.sort()).toEqual([...KNOWN_DEAD].sort());
  });
});
