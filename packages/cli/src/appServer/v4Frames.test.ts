import type { ZCodeSessionEvent } from "@zcode/shared";
import { pendingInteractionSchema } from "@zcode/shared/zcode-protocol-v4";
import type { Session } from "core/index.js";
import { describe, expect, it } from "vitest";

import {
  buildConversationSnapshot,
  createFrameSubscription,
  derivePendingInteractions,
} from "./v4Frames.js";

const session = {
  sessionId: "session-1",
  title: "Fixture",
  workspaceDirectory: "/workspace",
  history: [],
} as unknown as Session;

function permissionRequested(seq: number, requestId = "request-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "permission.requested",
    payload: {
      requestId,
      toolCallId: "tool-1",
      toolName: "bash",
      riskLevel: "medium",
      reason: "Run a shell command",
      input: { command: "ls" },
      options: [
        {
          optionId: "allow_once",
          kind: "allowOnce",
          name: "Allow once",
          response: { decision: "allow" },
        },
        {
          optionId: "deny",
          kind: "deny",
          name: "Deny",
          response: { decision: "deny" },
        },
      ],
    },
  } as unknown as ZCodeSessionEvent;
}

function permissionResolved(seq: number, requestId = "request-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "permission.resolved",
    payload: {
      requestId,
      toolCallId: "tool-1",
      decision: "allow",
    },
  } as unknown as ZCodeSessionEvent;
}

function userInputRequested(seq: number, requestId = "question-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "userInput.requested",
    payload: {
      requestId,
      prompt: "Which branch?",
      inputType: "choice",
      choices: ["main", "next"],
    },
  } as unknown as ZCodeSessionEvent;
}

function userInputResolved(seq: number, requestId = "question-1") {
  return {
    eventId: `session-1:event-${seq}`,
    sessionId: "session-1",
    seq,
    timestamp: 1_000 + seq,
    type: "userInput.resolved",
    payload: { requestId, cancelled: false, value: "main" },
  } as unknown as ZCodeSessionEvent;
}

describe("derivePendingInteractions", () => {
  it("keeps an unanswered permission request with its options", () => {
    const pending = derivePendingInteractions([permissionRequested(1)]);

    expect(pending).toHaveLength(1);
    const parsed = pendingInteractionSchema.parse(pending[0]);
    expect(parsed).toMatchObject({
      interactionId: "request-1",
      kind: "permission",
      anchorRowId: null,
      payload: {
        kind: "permission",
        toolCallId: "tool-1",
        toolName: "bash",
        summary: "Run a shell command",
        detail: { command: "ls" },
        options: [
          { optionId: "allow_once", label: "Allow once", kind: "allowOnce" },
          { optionId: "deny", label: "Deny", kind: "deny" },
        ],
      },
    });
  });

  it("drops a permission once its resolution event is retained", () => {
    expect(
      derivePendingInteractions([
        permissionRequested(1),
        permissionResolved(2),
      ]),
    ).toEqual([]);
  });

  it("projects an unanswered choice question", () => {
    const pending = derivePendingInteractions([userInputRequested(1)]);
    const parsed = pendingInteractionSchema.parse(pending[0]);

    expect(parsed).toMatchObject({
      interactionId: "question-1",
      kind: "userInput",
      anchorRowId: null,
      payload: {
        kind: "userInput",
        prompt: "Which branch?",
        freeText: false,
        options: [
          { optionId: "main", label: "main" },
          { optionId: "next", label: "next" },
        ],
      },
    });
  });

  it("drops a question once it is answered", () => {
    expect(
      derivePendingInteractions([userInputRequested(1), userInputResolved(2)]),
    ).toEqual([]);
  });

  it("publishes the pending interactions on the conversation snapshot", () => {
    const frame = createFrameSubscription(session, "sub-1", "epoch-1");
    const snapshot = buildConversationSnapshot(
      session,
      frame,
      { eventSeq: 2, stateRevision: 2 },
      false,
      derivePendingInteractions([permissionRequested(1)]),
    );

    expect(snapshot.pendingInteractions).toHaveLength(1);
    expect(snapshot.pendingInteractions[0]?.interactionId).toBe("request-1");
  });
});
