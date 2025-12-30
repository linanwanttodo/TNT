import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetAutoDenialState } from "../permissions/autoMode.js";
import { services } from "../services/index.js";

import { checkToolPermissionApproval } from "./streamChatResponse.helpers.js";

const writeCall = (path = "notes.txt") => ({
  id: "call-1",
  name: "Write",
  arguments: { filepath: path, content: "hello" },
});

const autoContextWith = (content: string | Error) => ({
  llmApi: {
    chatCompletionNonStream: vi.fn(async () => {
      if (content instanceof Error) throw content;
      return { choices: [{ message: { content } }] };
    }),
  },
  model: { model: "test-model" },
  history: [],
});

/**
 * Auto mode sits on top of the normal policy: an "ask" is answered by fast
 * paths or the classifier instead of the human. These cases pin the order and
 * the failure behavior, which is where a permission bug would hide.
 */
describe("checkToolPermissionApproval in auto mode", () => {
  const writeAskPolicies = {
    policies: [{ tool: "Write", permission: "ask" as const }],
  };

  beforeEach(async () => {
    resetAutoDenialState();
    await services.toolPermissions.doInitialize({ mode: "auto" });
  });

  it("allows a workspace edit without asking the classifier", async () => {
    const context = autoContextWith(
      '{"allow": false, "reason": "should not run"}',
    );

    const result = await checkToolPermissionApproval(
      writeAskPolicies as any,
      writeCall("src/in-workspace.txt") as any,
      undefined,
      false,
      { autoContext: context },
    );

    expect(result.approved).toBe(true);
    expect(context.llmApi.chatCompletionNonStream).not.toHaveBeenCalled();
  });

  it("allows a safe tool without asking the classifier", async () => {
    const context = autoContextWith('{"allow": false, "reason": "no"}');

    const result = await checkToolPermissionApproval(
      { policies: [{ tool: "Read", permission: "ask" }] } as any,
      { id: "call-2", name: "Read", arguments: { path: "x.txt" } } as any,
      undefined,
      false,
      { autoContext: context },
    );

    expect(result.approved).toBe(true);
    expect(context.llmApi.chatCompletionNonStream).not.toHaveBeenCalled();
  });

  it("runs the classifier for what is left and allows on its verdict", async () => {
    const context = autoContextWith(
      '{"allow": true, "reason": "writes the file the user asked for"}',
    );

    const result = await checkToolPermissionApproval(
      writeAskPolicies as any,
      writeCall("../outside.txt") as any,
      undefined,
      false,
      { autoContext: context },
    );

    expect(result.approved).toBe(true);
    expect(context.llmApi.chatCompletionNonStream).toHaveBeenCalledTimes(1);
  });

  it("denies on a blocking verdict with the classifier's reason", async () => {
    const context = autoContextWith(
      '{"allow": false, "reason": "overwrites a file outside the workspace"}',
    );

    const result = await checkToolPermissionApproval(
      writeAskPolicies as any,
      writeCall("../outside.txt") as any,
      undefined,
      false,
      { autoContext: context },
    );

    expect(result.approved).toBe(false);
    expect(result.message).toContain("overwrites a file outside the workspace");
  });

  it("fails closed in headless when the classifier is unavailable", async () => {
    const context = autoContextWith(new Error("network down"));

    const result = await checkToolPermissionApproval(
      writeAskPolicies as any,
      writeCall("../outside.txt") as any,
      undefined,
      true,
      { autoContext: context },
    );

    expect(result.approved).toBe(false);
    expect(result.denialReason).toBe("policy");
  });

  it("stops consulting the classifier after the denial limits", async () => {
    const block = autoContextWith('{"allow": false, "reason": "blocked"}');
    const ask = () =>
      checkToolPermissionApproval(
        writeAskPolicies as any,
        writeCall("../outside.txt") as any,
        undefined,
        true,
        { autoContext: block },
      );

    for (let i = 0; i < 3; i += 1) {
      expect((await ask()).approved).toBe(false);
    }
    expect(block.llmApi.chatCompletionNonStream).toHaveBeenCalledTimes(3);

    const breaker = await ask();
    expect(breaker.approved).toBe(false);
    // The breaker answered without another classifier call.
    expect(block.llmApi.chatCompletionNonStream).toHaveBeenCalledTimes(3);
  });
});
