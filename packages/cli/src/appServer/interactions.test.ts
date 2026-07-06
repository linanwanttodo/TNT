import {
  zcodePermissionRequestParamsSchema,
  zcodeUserInputRequestParamsSchema,
} from "@zcode/shared";
import { describe, expect, it, vi } from "vitest";

import { ToolPermissionManager } from "../permissions/permissionManager.js";
import type { AgentEvent } from "../protocol/events.js";
import { QuizService, type QuizQuestion } from "../services/QuizService.js";

import {
  InteractionBridge,
  type InteractionBridgeOptions,
  type InteractionRequestHandle,
  type InteractionSender,
} from "./interactions.js";
import { AppServerProtocol } from "./protocol.js";
import { SessionRuntimeStore } from "./runtime.js";
import { SessionRegistry } from "./sessionRegistry.js";

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

class FakeSender implements InteractionSender {
  readonly requests: { method: string; params: unknown }[] = [];
  readonly responses: { requestId: string; result: unknown }[] = [];
  private readonly resolvers = new Map<string, (result: unknown) => void>();
  private counter = 0;

  request(method: string, params: unknown): InteractionRequestHandle {
    this.counter += 1;
    const requestId = `test-${this.counter}`;
    this.requests.push({ method, params });
    const result = new Promise<unknown>((resolve) => {
      this.resolvers.set(requestId, resolve);
    });
    return { requestId, result };
  }

  respond(requestId: string, result: unknown): Promise<void> {
    this.responses.push({ requestId, result });
    return Promise.resolve();
  }

  complete(index: number, result: unknown): void {
    const requestId = `test-${index + 1}`;
    const resolve = this.resolvers.get(requestId);
    if (resolve) {
      this.resolvers.delete(requestId);
      resolve(result);
    }
  }
}

function createBridge(overrides: Partial<InteractionBridgeOptions> = {}) {
  const sender = new FakeSender();
  const manager = new ToolPermissionManager();
  const quiz = new QuizService();
  const runtimes = new SessionRuntimeStore();
  const bridge = new InteractionBridge({
    sender,
    runtimes,
    permissionManager: manager,
    quizService: quiz,
    resolveSessionId: () => "session-1",
    ...overrides,
  });
  return { sender, manager, quiz, runtimes, bridge };
}

describe("permission interactions", () => {
  it("advertises allow-once, allow-always and deny, then resolves the pending request", async () => {
    const { sender, manager, bridge } = createBridge();
    const pending = manager.requestPermission(
      {
        name: "bash",
        arguments: { command: "rm -rf build" },
        toolCallId: "call-1",
      },
      0,
    );
    await flush();

    expect(sender.requests).toHaveLength(1);
    expect(sender.requests[0]?.method).toBe("interaction/requestPermission");
    const params = zcodePermissionRequestParamsSchema.parse(
      sender.requests[0]?.params,
    );
    expect(params).toMatchObject({
      sessionId: "session-1",
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "rm -rf build" },
      reason: "Tool requires permission",
    });
    expect(params.options.map((option) => option.optionId)).toEqual([
      "allow_once",
      "allow_always",
      "deny",
    ]);

    const requestId = manager.getPendingRequestIds()[0] ?? "";
    expect(
      bridge.resolveInteraction(requestId, { optionId: "allow_always" }),
    ).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true, remember: true });
    expect(sender.responses).toEqual([
      { requestId: "test-1", result: { decision: "allow" } },
    ]);

    expect(bridge.resolveInteraction(requestId, { optionId: "deny" })).toBe(
      false,
    );
    expect(sender.responses).toHaveLength(1);
    bridge.dispose();
  });

  it("rejects the pending request for a deny option", async () => {
    const { manager, bridge } = createBridge();
    const pending = manager.requestPermission(
      { name: "write", arguments: { path: "a" } },
      0,
    );
    await flush();
    const requestId = manager.getPendingRequestIds()[0] ?? "";

    expect(bridge.resolveInteraction(requestId, { optionId: "deny" })).toBe(
      true,
    );
    await expect(pending).resolves.toEqual({ approved: false });
    expect(
      bridge.resolveInteraction(requestId, { optionId: "allow_once" }),
    ).toBe(false);
    bridge.dispose();
  });

  it("answers the pending request from the host's permission response", async () => {
    const { sender, manager, bridge } = createBridge();
    const pending = manager.requestPermission(
      { name: "read", arguments: { path: "a" } },
      0,
    );
    await flush();
    const requestId = manager.getPendingRequestIds()[0] ?? "";

    sender.complete(0, {
      decision: "allow",
      permissionUpdates: [
        { type: "addRules", behavior: "allow", rules: [{ toolName: "read" }] },
      ],
    });

    await expect(pending).resolves.toEqual({ approved: true, remember: true });
    expect(bridge.resolveInteraction(requestId, { optionId: "deny" })).toBe(
      false,
    );
    bridge.dispose();
  });
});

describe("question interactions", () => {
  it("emits userInput.requested and resolves the question through the protocol", async () => {
    const { sender, quiz, runtimes, bridge } = createBridge();
    const asked = quiz.askQuestion({
      question: "Which model?",
      options: ["a", "b"],
    });
    await flush();

    expect(sender.requests).toHaveLength(1);
    expect(sender.requests[0]?.method).toBe("interaction/requestUserInput");
    const params = zcodeUserInputRequestParamsSchema.parse(
      sender.requests[0]?.params,
    );
    expect(params).toMatchObject({
      requestId: expect.any(String),
      sessionId: "session-1",
      prompt: "Which model?",
    });
    expect(params.questions?.[0]?.options).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);

    const requested = runtimes
      .eventsAfter("session-1", 0)
      .filter((event) => event.type === "userInput.requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]?.payload).toMatchObject({
      prompt: "Which model?",
      inputType: "choice",
      choices: ["a", "b"],
    });

    const requestId = quiz.getState().pendingQuestion?.requestId ?? "";
    const answerQuestion = vi.spyOn(quiz, "answerQuestion");
    expect(bridge.resolveInteraction(requestId, { optionId: "option-1" })).toBe(
      true,
    );
    await expect(asked).resolves.toBe("b");
    expect(answerQuestion).toHaveBeenCalledTimes(1);
    expect(answerQuestion).toHaveBeenCalledWith(requestId, "b", false);
    await flush();

    const resolved = runtimes
      .eventsAfter("session-1", 0)
      .filter((event) => event.type === "userInput.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.payload).toMatchObject({ requestId, cancelled: false });
    expect(bridge.resolveInteraction(requestId, { optionId: "option-0" })).toBe(
      false,
    );
    bridge.dispose();
  });

  it("treats a web answer after the TUI answered as a no-op", async () => {
    const { sender, quiz, runtimes, bridge } = createBridge();
    const asked = quiz.askQuestion({
      question: "Continue?",
      options: ["yes", "no"],
    });
    await flush();
    const requestId = quiz.getState().pendingQuestion?.requestId ?? "";

    expect(quiz.answerQuestion(requestId, "yes")).toBe(true);
    await expect(asked).resolves.toBe("yes");
    await flush();

    expect(bridge.resolveInteraction(requestId, { optionId: "option-1" })).toBe(
      false,
    );
    await expect(asked).resolves.toBe("yes");
    expect(sender.responses).toEqual([
      {
        requestId: "test-1",
        result: { action: "accept", content: { answer: "yes" } },
      },
    ]);
    const resolved = runtimes
      .eventsAfter("session-1", 0)
      .filter((event) => event.type === "userInput.resolved");
    expect(resolved).toHaveLength(1);
    bridge.dispose();
  });

  it("does not duplicate the events an in-process TUI relay already published", async () => {
    let relay: ((event: AgentEvent) => void) | null = null;
    const events = {
      subscribe: (listener: (event: AgentEvent) => void): (() => void) => {
        relay = listener;
        return () => {
          relay = null;
        };
      },
    };
    const { sender, quiz, runtimes, bridge } = createBridge({ events });

    const onRequested = (event: {
      requestId: string;
      question: QuizQuestion;
    }): void => {
      const agentEvent: AgentEvent = {
        sessionId: "session-tui",
        turnId: "turn-1",
        seq: 1,
        timestamp: Date.now(),
        type: "question.requested",
        requestId: event.requestId,
        question: event.question.question,
        options: event.question.options,
      };
      relay?.(agentEvent);
      runtimes.append(
        "session-tui",
        "userInput.requested",
        {
          requestId: event.requestId,
          prompt: event.question.question,
          inputType: "choice",
          choices: event.question.options,
        },
        Date.now(),
        "turn-1",
      );
    };
    const onAnswered = (event: { requestId: string }): void => {
      runtimes.append(
        "session-tui",
        "userInput.resolved",
        { requestId: event.requestId, cancelled: false },
        Date.now(),
        "turn-1",
      );
    };
    quiz.on("questionRequested", onRequested);
    quiz.on("questionAnswered", onAnswered);

    const asked = quiz.askQuestion({
      question: "Pick one",
      options: ["a", "b"],
    });
    await flush();

    const params = zcodeUserInputRequestParamsSchema.parse(
      sender.requests[0]?.params,
    );
    expect(params.sessionId).toBe("session-tui");
    expect(
      runtimes
        .eventsAfter("session-tui", 0)
        .filter((event) => event.type === "userInput.requested"),
    ).toHaveLength(1);

    const requestId = quiz.getState().pendingQuestion?.requestId ?? "";
    expect(quiz.answerQuestion(requestId, "a")).toBe(true);
    await expect(asked).resolves.toBe("a");
    await flush();

    expect(bridge.resolveInteraction(requestId, { optionId: "option-1" })).toBe(
      false,
    );
    expect(
      runtimes
        .eventsAfter("session-tui", 0)
        .filter((event) => event.type === "userInput.resolved"),
    ).toHaveLength(1);
    bridge.dispose();
  });
});

describe("interaction lifecycle", () => {
  it("unsubscribes on dispose and ignores answers afterwards", async () => {
    const { sender, manager, bridge } = createBridge();
    const pending = manager.requestPermission(
      { name: "bash", arguments: {} },
      0,
    );
    await flush();
    const requestId = manager.getPendingRequestIds()[0] ?? "";

    bridge.dispose();
    expect(
      bridge.resolveInteraction(requestId, { optionId: "allow_once" }),
    ).toBe(false);
    expect(manager.approveRequest(requestId)).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true, remember: false });

    const before = sender.requests.length;
    const second = manager.requestPermission(
      { name: "read", arguments: {} },
      0,
    );
    await flush();
    expect(sender.requests).toHaveLength(before);
    manager.rejectRequest(manager.getPendingRequestIds()[0] ?? "");
    await expect(second).resolves.toEqual({ approved: false });
  });

  it("routes an inbound response to the bridge through the protocol", async () => {
    const manager = new ToolPermissionManager();
    const quiz = new QuizService();
    const sent: Record<string, unknown>[] = [];
    const transport = {
      send: async (message: unknown): Promise<void> => {
        sent.push(message as Record<string, unknown>);
      },
    };
    const protocol = new AppServerProtocol(transport, new SessionRegistry(), {
      permissionManager: manager,
      quizService: quiz,
      resolveSessionId: () => "session-1",
    });
    const pending = manager.requestPermission(
      { name: "bash", arguments: { command: "ls" } },
      0,
    );
    await flush();

    const request = sent.find(
      (message) => message.method === "interaction/requestPermission",
    );
    expect(request).toBeDefined();
    await protocol.handle({ id: request?.id, result: { decision: "allow" } });

    await expect(pending).resolves.toEqual({
      approved: true,
      remember: false,
    });
    protocol.dispose();
  });

  it("tolerates dispose while an interaction request is outstanding", async () => {
    const manager = new ToolPermissionManager();
    const quiz = new QuizService();
    const sent: Record<string, unknown>[] = [];
    const transport = {
      send: async (message: unknown): Promise<void> => {
        sent.push(message as Record<string, unknown>);
      },
    };
    const protocol = new AppServerProtocol(transport, new SessionRegistry(), {
      permissionManager: manager,
      quizService: quiz,
      resolveSessionId: () => "session-1",
    });
    const pending = manager.requestPermission(
      { name: "bash", arguments: {} },
      0,
    );
    await flush();
    const requestId = manager.getPendingRequestIds()[0] ?? "";

    protocol.dispose();
    await flush();
    expect(manager.approveRequest(requestId)).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true, remember: false });
  });
});
