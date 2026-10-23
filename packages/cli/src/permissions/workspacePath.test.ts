import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isWithinWorkspace,
  setAdditionalWorkspaceDirectories,
} from "./workspacePath.js";

const roots: string[] = [];

function root(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-workspace-"));
  roots.push(directory);
  return directory;
}

afterEach(() => {
  setAdditionalWorkspaceDirectories([]);
  for (const directory of roots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("additional workspace directories", () => {
  it("treats an extra root as workspace and clears it again", () => {
    const extra = root();
    const outside = root();

    setAdditionalWorkspaceDirectories([extra]);
    expect(isWithinWorkspace(path.join(extra, "nested", "file.ts"))).toBe(true);
    expect(isWithinWorkspace(path.join(outside, "file.ts"))).toBe(false);

    setAdditionalWorkspaceDirectories([]);
    expect(isWithinWorkspace(path.join(extra, "file.ts"))).toBe(false);
  });

  it("does not apply extra roots when a caller names its own root", () => {
    const extra = root();
    const custom = root();
    setAdditionalWorkspaceDirectories([extra]);

    expect(isWithinWorkspace(path.join(extra, "file.ts"), custom)).toBe(false);
  });
});
