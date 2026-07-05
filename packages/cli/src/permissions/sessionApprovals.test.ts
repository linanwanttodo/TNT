import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCurrentSessionId, startNewSession } from "../session/index.js";

import {
  clearSessionApprovals,
  hasSessionApproval,
  rememberSessionApproval,
  sessionApprovalKey,
  sessionApprovalKeys,
} from "./sessionApprovals.js";

/**
 * "Don't ask again this session" sits between once and always: it must cover
 * exactly what the user read, live only in memory, and not follow the process into
 * another session. Each of those is a case here, because the failure mode of an
 * approval cache is a permission nobody agreed to.
 */
describe("sessionApprovalKey", () => {
  it("normalizes a shell line without reducing a chain to its first command", () => {
    expect(sessionApprovalKey("Bash", { command: "  ls   -la  " })).toBe(
      `Bash(${process.cwd()}::ls -la)`,
    );
    expect(
      sessionApprovalKey("Bash", { command: "git add . && git commit" }),
    ).toBe(`Bash(${process.cwd()}::git add . && git commit)`);
    // Not the same permission as either half on its own.
    expect(sessionApprovalKey("Bash", { command: "git add ." })).not.toBe(
      sessionApprovalKey("Bash", { command: "git add . && git commit" }),
    );
  });

  it("keys the same relative line differently per working directory", () => {
    const spy = vi.spyOn(process, "cwd");
    spy.mockReturnValueOnce("/repo/one");
    const fromOne = sessionApprovalKey("Bash", { command: "rm notes.txt" });
    spy.mockReturnValueOnce("/repo/two");
    const fromTwo = sessionApprovalKey("Bash", { command: "rm notes.txt" });
    spy.mockRestore();

    expect(fromOne).not.toBe(fromTwo);
    expect(fromOne).toContain("/repo/one::rm notes.txt");
    expect(fromTwo).toContain("/repo/two::rm notes.txt");
  });

  it("scopes a write to the tool and the resolved file", () => {
    const edit = sessionApprovalKey("Edit", { filepath: "src/a.ts" });
    const write = sessionApprovalKey("Write", { filepath: "src/a.ts" });
    const elsewhere = sessionApprovalKey("Edit", {
      filepath: "./src/../src/a.ts",
    });

    expect(edit).toContain("Edit(");
    expect(edit).not.toBe(write);
    expect(edit).toBe(elsewhere);
    // The key carries a resolved path, which is `C:\...\src\a.ts` on Windows;
    // naming the whole key says the same thing on every platform and is a
    // stronger claim than the trailing-slash match it replaces.
    expect(edit).toBe(`Edit(${path.resolve("src/a.ts")})`);
  });

  it("refuses to build a key for what it cannot bound", () => {
    // An MCP server's arguments can name anything, and the server is not ours
    // to reason about.
    expect(
      sessionApprovalKey("mcp__github__push_files", { a: 1 }),
    ).toBeUndefined();
    // A tool whose arguments are not about one thing this call can repeat.
    expect(
      sessionApprovalKey("Read", { filepath: "src/a.ts" }),
    ).toBeUndefined();
    expect(sessionApprovalKey("Bash", { command: "   " })).toBeUndefined();
    expect(sessionApprovalKey("Edit", {})).toBeUndefined();
    expect(sessionApprovalKey("Bash", undefined)).toBeUndefined();
  });

  it("never holds a destructive command for the session", () => {
    for (const command of [
      "git reset --hard",
      "git clean -fd",
      "git checkout -- src/app.ts",
      "rm -rf /tmp/outside",
    ]) {
      expect(sessionApprovalKey("Bash", { command }), command).toBeUndefined();
      expect(rememberSessionApproval("Bash", { command })).toBeUndefined();
      expect(hasSessionApproval("Bash", { command })).toBe(false);
    }
    // A normal command still gets its key.
    expect(sessionApprovalKey("Bash", { command: "git status" })).toContain(
      "git status",
    );
  });
});

describe("the session's approval store", () => {
  let previousSessionId: string | undefined;

  beforeEach(() => {
    previousSessionId = process.env.TNT_TEST_SESSION_ID;
    process.env.TNT_TEST_SESSION_ID = "approvals-test-one";
    startNewSession();
    clearSessionApprovals();
  });

  afterEach(() => {
    clearSessionApprovals();
    if (previousSessionId === undefined) {
      delete process.env.TNT_TEST_SESSION_ID;
    } else {
      process.env.TNT_TEST_SESSION_ID = previousSessionId;
    }
    startNewSession();
  });

  it("remembers what it was given and answers only for the same call", () => {
    expect(hasSessionApproval("Bash", { command: "npm run build" })).toBe(
      false,
    );

    const key = rememberSessionApproval("Bash", { command: "npm  run  build" });

    expect(key).toBe(`Bash(${process.cwd()}::npm run build)`);
    expect(hasSessionApproval("Bash", { command: "npm run build" })).toBe(true);
    expect(hasSessionApproval("Bash", { command: "npm test" })).toBe(false);
    expect(sessionApprovalKeys()).toEqual([key]);
  });

  it("keeps nothing that cannot be bounded", () => {
    expect(rememberSessionApproval("mcp__x__y", { q: 1 })).toBeUndefined();
    expect(sessionApprovalKeys()).toEqual([]);
  });

  it("does not carry a grant into another session", () => {
    rememberSessionApproval("Bash", { command: "npm test" });
    expect(hasSessionApproval("Bash", { command: "npm test" })).toBe(true);

    const firstSession = getCurrentSessionId();
    startNewSession();

    expect(getCurrentSessionId()).not.toBe(firstSession);
    expect(hasSessionApproval("Bash", { command: "npm test" })).toBe(false);
    expect(sessionApprovalKeys()).toEqual([]);
  });

  it("drops the whole store when asked, because the user can revoke it", () => {
    rememberSessionApproval("Edit", { filepath: "src/a.ts" });
    expect(hasSessionApproval("Edit", { filepath: "src/a.ts" })).toBe(true);

    clearSessionApprovals();

    expect(hasSessionApproval("Edit", { filepath: "src/a.ts" })).toBe(false);
  });
});
