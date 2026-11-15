import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The assistant scaffold is written into a user's workspace, so its two links are read by
 * every person who runs it. One of them pointed at `docs/customization/models`, which does not
 * exist - a 404 in a file the tool itself created. This reads the links out of the source and
 * checks each repository path is really there.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const SOURCE = path.join(here, "createNewAssistantFile.ts");

function scaffoldLinks(): string[] {
  const source = fs.readFileSync(SOURCE, "utf-8");
  return [
    ...new Set(
      [
        ...source.matchAll(
          /github\.com\/linanwanttodo\/TNT\/(?:tree|blob)\/main\/([^`\s"']+)/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
}

describe("the assistant scaffold's documentation links", () => {
  it("point at paths that exist in this repository", () => {
    const links = scaffoldLinks();

    // Without the floor a broken pattern would pass by finding nothing.
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(
      links.filter((link) => !fs.existsSync(path.join(repoRoot, link))),
    ).toEqual([]);
  });
});
