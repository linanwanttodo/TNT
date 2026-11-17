import { describe, expect, it } from "vitest";

import {
  createManagedWorktree,
  ManagedWorktreeError,
} from "./managedWorktree.js";

/**
 * The ref comes from the WebUI, so it must be rejected before any git call: a
 * ref starting with "-" would be parsed by git as an option instead of a
 * revision (argv injection).
 */
describe("createManagedWorktree ref validation", () => {
  it("rejects a ref that git would parse as an option", async () => {
    for (const ref of ["--upload-pack=/tmp/evil", "-b"]) {
      const error = await createManagedWorktree({
        workspacePath: "/tmp/tnt-not-a-repo",
        ref,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ManagedWorktreeError);
      expect((error as ManagedWorktreeError).code).toBe("invalid-ref");
    }
  });

  it("rejects a ref starting with '-' before resolving the workspace", async () => {
    // The validation runs before resolveContext, so an invalid ref fails even
    // when the workspace path is not a repository at all.
    const error = await createManagedWorktree({
      workspacePath: "/tmp/tnt-not-a-repo",
      ref: "--shared=whatever",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedWorktreeError);
    expect((error as ManagedWorktreeError).message).toContain(
      "must not start with '-'",
    );
    expect((error as ManagedWorktreeError).detail).toBe("--shared=whatever");
  });
});
