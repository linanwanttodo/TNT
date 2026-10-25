import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  AUTO_DENIAL_LIMITS,
  AUTO_SAFE_TOOLS,
  buildAutoClassifierMessages,
  classifyAutoAction,
  createAutoDenialState,
  recordAutoDenial,
  recordAutoSuccess,
  shouldFallbackToPrompting,
} from "./autoMode.js";

/**
 * Auto mode replaces the permission prompt with a classifier. The pieces that
 * can be wrong silently are the fast paths (a write tool slipping into the
 * safe list), the deny bookkeeping (never falling back to the human) and the
 * failure handling (a broken classifier approving everything).
 */
describe("auto mode", () => {
  it("keeps write and command tools out of the safe allowlist", () => {
    for (const name of ["Read", "Glob", "List", "Diff"]) {
      expect(AUTO_SAFE_TOOLS.has(name)).toBe(true);
    }
    for (const name of ["Write", "Edit", "MultiEdit", "Bash", "Fetch"]) {
      expect(AUTO_SAFE_TOOLS.has(name)).toBe(false);
    }
  });

  it("does not fast-path a search, because its target can leave the workspace", () => {
    // The acceptEdits check in resolveAutoModeDecision still lets an
    // in-workspace search through without a classifier call; one that names an
    // outside target reaches the classifier instead.
    expect(AUTO_SAFE_TOOLS.has("Search")).toBe(false);
  });

  it("falls back to prompting after the denial limits", () => {
    let state = createAutoDenialState();
    expect(shouldFallbackToPrompting(state)).toBe(false);

    for (let i = 0; i < AUTO_DENIAL_LIMITS.consecutive; i += 1) {
      state = recordAutoDenial(state);
    }
    expect(shouldFallbackToPrompting(state)).toBe(true);

    state = recordAutoSuccess(state);
    expect(shouldFallbackToPrompting(state)).toBe(false);

    state = createAutoDenialState();
    for (let i = 0; i < AUTO_DENIAL_LIMITS.total; i += 1) {
      state = recordAutoDenial(state);
      if (i < AUTO_DENIAL_LIMITS.total - 1) {
        // Interleaved successes reset the consecutive count but not the total.
        state = recordAutoSuccess(state);
      }
    }
    expect(state.total).toBe(AUTO_DENIAL_LIMITS.total);
    expect(shouldFallbackToPrompting(state)).toBe(true);
  });

  it("builds a classifier prompt with the action, the transcript and the block rules", () => {
    const history = [
      {
        message: { role: "user", content: "clean up the build output" },
        contextItems: [],
      },
      {
        message: {
          role: "assistant",
          content: "I will remove the dist folder.",
        },
        contextItems: [],
      },
    ] as ChatHistoryItem[];

    const { system, user } = buildAutoClassifierMessages({
      toolName: "Bash",
      toolArgs: { command: "rm -rf dist" },
      history,
      actionIndex: 2,
    });

    expect(system).toContain("rm -rf");
    expect(system).toContain("force push");
    expect(system).toContain("credentials");
    expect(user).toContain("clean up the build output");
    expect(user).toContain("rm -rf dist");
    expect(user).toContain("Bash");
    // The verdict shape is stated where the model can follow it.
    expect(system).toContain('"allow"');
  });

  it("truncates oversized arguments before they reach the classifier", () => {
    const { user } = buildAutoClassifierMessages({
      toolName: "Write",
      toolArgs: { path: "a.txt", content: "x".repeat(50_000) },
      history: [],
      actionIndex: 1,
    });

    expect(user.length).toBeLessThan(6_000);
  });

  const classify = (reply: string | Error) => {
    const llmApi = {
      chatCompletionNonStream: vi.fn(async () => {
        if (reply instanceof Error) throw reply;
        return { choices: [{ message: { content: reply } }] };
      }),
    };
    return classifyAutoAction({
      toolName: "Bash",
      toolArgs: { command: "npm test" },
      history: [],
      actionIndex: 0,
      llmApi,
      model: { model: "test-model" },
      signal: new AbortController().signal,
    });
  };

  it("allows and blocks on the classifier's JSON verdict", async () => {
    await expect(
      classify('{"allow": true, "reason": "runs the test suite"}'),
    ).resolves.toEqual({
      outcome: "allow",
      reason: "runs the test suite",
    });

    await expect(
      classify(
        '```json\n{"allow": false, "reason": "deletes files outside the workspace"}\n```',
      ),
    ).resolves.toEqual({
      outcome: "block",
      reason: "deletes files outside the workspace",
    });
  });

  it("reports an unavailable classifier instead of guessing", async () => {
    await expect(
      classify("I think this is probably fine."),
    ).resolves.toMatchObject({
      outcome: "unavailable",
    });
    await expect(classify(new Error("network down"))).resolves.toMatchObject({
      outcome: "unavailable",
    });
  });
});
