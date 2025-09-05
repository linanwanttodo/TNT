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
      "Bash(ls -la)",
    );
    expect(
      sessionApprovalKey("Bash", { command: "git add . && git commit" }),
    ).toBe("Bash(git add . && git commit)");
    // Not the same permission as either half on its own.
    expect(sessionApprovalKey("Bash", { command: "git add ." })).not.toBe(
      sessionApprovalKey("Bash", { command: "git add . && git commit" }),
    );
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
    expect(edit?.endsWith("/src/a.ts)")).toBe(true);
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
});

describe("the session's approval store", () => {
  let previousSessionId: string | undefined;

  beforeEach(() => {
    previousSessionId = process.env.CONTINUE_CLI_TEST_SESSION_ID;
    process.env.CONTINUE_CLI_TEST_SESSION_ID = "approvals-test-one";
    startNewSession();
    clearSessionApprovals();
  });

  afterEach(() => {
    clearSessionApprovals();
    if (previousSessionId === undefined) {
      delete process.env.CONTINUE_CLI_TEST_SESSION_ID;
    } else {
      process.env.CONTINUE_CLI_TEST_SESSION_ID = previousSessionId;
    }
    startNewSession();
  });

  it("remembers what it was given and answers only for the same call", () => {
    expect(hasSessionApproval("Bash", { command: "npm run build" })).toBe(
      false,
    );

    const key = rememberSessionApproval("Bash", { command: "npm  run  build" });

    expect(key).toBe("Bash(npm run build)");
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
