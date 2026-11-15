import path from "path";
import { pathToFileURL } from "url";

import { describe, expect, it } from "vitest";

import { toDisplayPath } from "../utils/displayPath.js";

import { describeLspUri } from "./lspLocations.js";

/**
 * Tool results are text the model quotes back and pastes into a shell, so the
 * separators in them are a product property, not a platform detail. The Windows
 * shapes are constructed as strings rather than run through `path`, which is what
 * lets all of this be checked on the runner that does not use backslashes.
 */
describe("the path a tool shows", () => {
  it("folds both separators", () => {
    expect(toDisplayPath("src\\agent\\atMentions.ts")).toBe(
      "src/agent/atMentions.ts",
    );
    expect(toDisplayPath("src/agent/atMentions.ts")).toBe(
      "src/agent/atMentions.ts",
    );
    expect(toDisplayPath("C:\\repo\\a.ts")).toBe("C:/repo/a.ts");
  });

  it("describes a file under the workspace relative to it", () => {
    const uri = pathToFileURL(path.join(process.cwd(), "package.json")).href;

    expect(describeLspUri(uri)).toBe("package.json");
  });

  it("keeps the server's own path when the file is elsewhere", () => {
    // The shape a Windows runner hits when a language server answers about a
    // root that is not the current drive: `fileURLToPath` would re-base it onto
    // `C:\...` and the relative form would be `..\..\workspace\src\a.ts`.
    const described = describeLspUri("file:///workspace/src/a.ts");

    expect(described).toBe("/workspace/src/a.ts");
    expect(described).not.toContain("file://");
    expect(described).not.toContain("..");
  });

  it("passes through what is not a file and marks nothing as unknown", () => {
    expect(describeLspUri("untitled:Untitled-1")).toBe("untitled:Untitled-1");
    expect(describeLspUri(undefined)).toBe("?");
  });
});
