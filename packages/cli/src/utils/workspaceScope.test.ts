import { describe, expect, it } from "vitest";

import { runInWorkspaceScope, workspaceRoot } from "./workspaceScope.js";

describe("workspace scope", () => {
  it("isolates concurrent workspace roots", async () => {
    await Promise.all([
      runInWorkspaceScope("/tmp/first", async () => {
        await Promise.resolve();
        expect(workspaceRoot()).toBe("/tmp/first");
      }),
      runInWorkspaceScope("/tmp/second", async () => {
        expect(workspaceRoot()).toBe("/tmp/second");
      }),
    ]);
  });
});
