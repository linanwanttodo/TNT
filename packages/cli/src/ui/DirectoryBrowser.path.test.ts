import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const uiSource = path.resolve(
  import.meta.dirname,
  "../../../zcode-ui/ui/src/DirectoryBrowser.path.ts",
);
const source = readFileSync(uiSource, "utf8");

describe("local directory browser source", () => {
  it("normalizes the parent path instead of sending a literal dot-dot to the service", () => {
    expect(source).toContain("parentDirectoryPath");
    expect(source).toContain('segments[segments.length - 1] === ".."');
    expect(source).not.toContain(
      'navigateTo(parentDirectoryPath(currentPath) + "/..")',
    );
  });

  it("joins child entries against the displayed directory", () => {
    const browser = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../zcode-ui/ui/src/DirectoryBrowser.tsx",
      ),
      "utf8",
    );
    expect(browser).toContain(
      'childDirectoryPath(currentPath || ".", entry.name)',
    );
    expect(browser).not.toContain("node:path");
  });
});
