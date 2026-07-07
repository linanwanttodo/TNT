/* eslint-disable max-lines -- permission and question requests share the bridge's pending maps */
import { zcodeProtocolMethods } from "@zcode/shared";

import type { InteractionBroker } from "../permissions/interactionBroker.js";
import {
  toolPermissionManager,
  type ToolPermissionManager,
} from "../permissions/permissionManager.js";
import type { ToolCallRequest } from "../permissions/types.js";
import { subscribeAgentEvents } from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";
import {
  formatQuizAnswer,
  quizService,
  type QuizItemAnswer,
  type QuizQuestion,
  type QuizService,
} from "../services/QuizService.js";
import { logger } from "../utils/logger.js";

import {
  answerFromContent,
  answersFromContent,
  asRecord,
  choiceForQuestions,
  permissionParams,
  questionSetFrom,
  userInputParams,
  type PendingPermission,
  type PendingQuestion,
} from "./interactionPayload.js";
import type { SessionRuntimeStore } from "./runtime.js";

export interface InteractionRequestHandle {
  readonly requestId: string;
  readonly result: Promise<unknown>;
}

export interface InteractionSender {
  request(method: string, params: unknown): InteractionRequestHandle;
  respond(requestId: string, result: unknown): Promise<void>;
}

export interface InteractionAnswer {
  optionId?: string;
  freeText?: string;
  action?: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

export interface InteractionBridgeOptions {
  sender: InteractionSender;
  runtimes: SessionRuntimeStore;
  permissionManager?: ToolPermissionManager;
  quizService?: QuizService;
  broker?: InteractionBroker;
  events?: { subscribe(listener: (event: AgentEvent) => void): () => void };
  resolveSessionId?: () => string | null;
}

interface AgentEventIdentity {
  sessionId: string;
  turnId: string;
}

/**
 * Translates the engine's two interactive requests into the ZCode protocol:
 * `interaction/requestPermission` and `interaction/requestUserInput`. The same
 * interaction is also registered locally so a `resolveInteraction` command can
 * answer it; whichever surface answers first wins and every later answer is a
 * no-op. The TUI keeps its own listeners on both managers, so in a TUI process
 * this bridge only mirrors prompts, it never answers them on its own.
 */
export class InteractionBridge {
  private readonly sender: InteractionSender;
  private readonly runtimes: SessionRuntimeStore;
  private readonly permissionManager: ToolPermissionManager;
  private readonly quiz: QuizService;
  private readonly broker: InteractionBroker;
  private readonly resolveSessionId: () => string | null;
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly questions = new Map<string, PendingQuestion>();
  private readonly questionIdentities = new Map<string, AgentEventIdentity>();
  private readonly unsubscribeEvents: () => void;
  private disposed = false;

  constructor(options: InteractionBridgeOptions) {
    this.sender = options.sender;
    this.runtimes = options.runtimes;
    const permissionManager =
      options.permissionManager ?? toolPermissionManager;
    const quiz = options.quizService ?? quizService;
    this.permissionManager = permissionManager;
    this.quiz = quiz;
    this.broker = options.broker ?? {
      approve: (requestId, remember = false) =>
        permissionManager.approveRequest(requestId, remember),
      reject: (requestId) => permissionManager.rejectRequest(requestId),
      answerQuestion: (requestId, answer, isCustomAnswer = false, answers) =>
        answers
          ? quiz.answerQuestion(requestId, answer, isCustomAnswer, answers)
          : quiz.answerQuestion(requestId, answer, isCustomAnswer),
    };
    this.resolveSessionId = options.resolveSessionId ?? (() => null);
    const events = options.events ?? { subscribe: subscribeAgentEvents };
    this.unsubscribeEvents = events.subscribe(this.onAgentEvent);
    permissionManager.on("permissionRequested", this.onPermissionRequested);
    permissionManager.on("permissionResponse", this.onPermissionResponse);
    quiz.on("questionRequested", this.onQuestionRequested);
    quiz.on("questionAnswered", this.onQuestionAnswered);
  }

  /**
   * Answers a registered interaction. Returns false when the id is unknown or
   * the interaction was already answered, which is what makes a late answer a
   * no-op instead of a double resolution.
   */
  resolveInteraction(
    interactionId: string,
    answer: InteractionAnswer,
  ): boolean {
    if (this.disposed) {
      return false;
    }
    if (this.permissions.has(interactionId)) {
      return this.resolvePermission(interactionId, answer);
    }
    if (this.questions.has(interactionId)) {
      return this.resolveQuestion(interactionId, answer);
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.permissionManager.off(
      "permissionRequested",
      this.onPermissionRequested,
    );
    this.permissionManager.off("permissionResponse", this.onPermissionResponse);
    this.quiz.off("questionRequested", this.onQuestionRequested);
    this.quiz.off("questionAnswered", this.onQuestionAnswered);
    this.unsubscribeEvents();
    this.permissions.clear();
    this.questions.clear();
    this.questionIdentities.clear();
  }

  private readonly onPermissionRequested = (event: unknown): void => {
    if (this.disposed) {
      return;
    }
    const record = asRecord(event);
    const requestId = record.requestId;
    const toolCall = record.toolCall as ToolCallRequest | undefined;
    if (typeof requestId !== "string" || !toolCall) {
      return;
    }
    this.permissions.set(requestId, {
      requestId,
      toolCall,
      sessionId: null,
      turnId: null,
      toolCallId: null,
      outgoing: null,
    });
    queueMicrotask(() => {
      void this.emitPermission(requestId);
    });
  };

  private readonly onPermissionResponse = (event: unknown): void => {
    const record = asRecord(event);
    const requestId = record.requestId;
    if (typeof requestId !== "string") {
      return;
    }
    const pending = this.permissions.get(requestId);
    if (!pending) {
      return;
    }
    this.permissions.delete(requestId);
    this.recordPermissionResolved(pending, requestId, record);
    if (pending.outgoing) {
      const outgoing = pending.outgoing;
      pending.outgoing = null;
      this.respond(outgoing, {
        decision: record.approved === true ? "allow" : "deny",
      });
    }
  };

  private readonly onQuestionRequested = (event: unknown): void => {
    if (this.disposed) {
      return;
    }
    const record = asRecord(event);
    const requestId = record.requestId;
    const questions = questionSetFrom(record);
    if (typeof requestId !== "string" || !questions) {
      return;
    }
    this.questions.set(requestId, {
      requestId,
      questions,
      sessionId: null,
      turnId: null,
      outgoing: null,
    });
    queueMicrotask(() => {
      void this.emitQuestion(requestId);
    });
  };

  private readonly onQuestionAnswered = (event: unknown): void => {
    const record = asRecord(event);
    const requestId = record.requestId;
    if (typeof requestId !== "string") {
      return;
    }
    const pending = this.questions.get(requestId);
    if (!pending) {
      return;
    }
    this.questions.delete(requestId);
    if (pending.outgoing) {
      const outgoing = pending.outgoing;
      pending.outgoing = null;
      this.respond(outgoing, {
        action: "accept",
        content: {
          answer: typeof record.answer === "string" ? record.answer : "",
        },
      });
    }
    queueMicrotask(() => {
      this.recordResolved(pending, record.answer);
    });
  };

  private readonly onAgentEvent = (event: AgentEvent): void => {
    if (this.disposed) {
      return;
    }
    if (event.type === "permission.requested") {
      const pending = this.permissions.get(event.requestId);
      if (pending) {
        pending.sessionId ??= event.sessionId;
        pending.turnId ??= event.turnId;
        pending.toolCallId ??= event.toolCallId ?? null;
      }
      return;
    }
    if (event.type === "question.requested") {
      this.questionIdentities.set(event.requestId, {
        sessionId: event.sessionId,
        turnId: event.turnId,
      });
    }
  };

  private async emitPermission(requestId: string): Promise<void> {
    const pending = this.permissions.get(requestId);
    if (!pending || this.disposed) {
      return;
    }
    const sessionId = pending.sessionId ?? this.resolveSessionId();
    if (!sessionId) {
      logger.debug("AppServer: permission request has no session", {
        requestId,
      });
      return;
    }
    const outgoing = this.sender.request(
      zcodeProtocolMethods.interactionRequestPermission,
      permissionParams(pending, sessionId),
    );
    pending.outgoing = outgoing.requestId;
    try {
      this.applyPermissionResult(requestId, await outgoing.result);
    } catch {
      // Delivery failed or the protocol was disposed: the engine's own surface
      // or timeout still owns the prompt. Never invent an answer.
    } finally {
      if (pending.outgoing === outgoing.requestId) {
        pending.outgoing = null;
      }
    }
  }

  private async emitQuestion(requestId: string): Promise<void> {
    const pending = this.questions.get(requestId);
    if (!pending || this.disposed) {
      return;
    }
    const identity = this.questionIdentities.get(requestId);
    const sessionId =
      pending.sessionId ?? identity?.sessionId ?? this.resolveSessionId();
    if (!sessionId) {
      logger.debug("AppServer: question request has no session", { requestId });
      return;
    }
    pending.sessionId = sessionId;
    pending.turnId ??= identity?.turnId ?? null;
    if (!this.hasQuestionEvent(sessionId, "userInput.requested", requestId)) {
      const first = pending.questions[0];
      const choices = first?.options ?? [];
      this.runtimes.append(
        sessionId,
        "userInput.requested",
        {
          requestId,
          prompt: first?.question ?? "",
          ...(choices.length > 0
            ? { inputType: "choice", choices: [...choices] }
            : { inputType: "text" }),
          ...(pending.questions.length > 1
            ? { questions: pending.questions }
            : {}),
        },
        Date.now(),
        pending.turnId,
      );
    }
    const outgoing = this.sender.request(
      zcodeProtocolMethods.interactionRequestUserInput,
      userInputParams(pending, sessionId),
    );
    pending.outgoing = outgoing.requestId;
    try {
      this.applyQuestionResult(requestId, await outgoing.result);
    } catch {
      // See emitPermission: a failed delivery is not an answer.
    } finally {
      if (pending.outgoing === outgoing.requestId) {
        pending.outgoing = null;
      }
    }
  }

  private applyPermissionResult(requestId: string, result: unknown): void {
    const pending = this.permissions.get(requestId);
    if (!pending) {
      return;
    }
    const record = asRecord(result);
    if (record.decision !== "allow" && record.decision !== "deny") {
      return;
    }
    pending.outgoing = null;
    const remember =
      Array.isArray(record.permissionUpdates) &&
      record.permissionUpdates.length > 0;
    if (record.decision === "allow") {
      this.broker.approve(requestId, remember);
    } else {
      this.broker.reject(requestId);
    }
  }

  private applyQuestionResult(requestId: string, result: unknown): void {
    const pending = this.questions.get(requestId);
    if (!pending) {
      return;
    }
    const record = asRecord(result);
    pending.outgoing = null;
    if (record.action === "accept") {
      this.answerWithContent(pending, record.content, true);
    } else if (record.action === "decline" || record.action === "cancel") {
      this.broker.answerQuestion(requestId, "");
    }
  }

  private answerWithContent(
    pending: PendingQuestion,
    content: unknown,
    isCustomAnswer: boolean,
  ): void {
    const answers = answersFromContent(pending.questions, content);
    const answer = answers
      ? formatQuizAnswer(pending.questions, answers)
      : answerFromContent(content);
    this.broker.answerQuestion(
      pending.requestId,
      answer,
      isCustomAnswer,
      answers,
    );
  }

  private resolvePermission(
    requestId: string,
    answer: InteractionAnswer,
  ): boolean {
    const optionId = answer.optionId;
    if (optionId === "allow_always") {
      return this.broker.approve(requestId, true);
    }
    if (optionId === "allow_once" || optionId === "allow") {
      return this.broker.approve(requestId, false);
    }
    if (
      optionId === "deny" ||
      optionId === "reject_once" ||
      optionId === "reject_always"
    ) {
      return this.broker.reject(requestId);
    }
    if (answer.action === "accept") {
      return this.broker.approve(requestId, false);
    }
    if (answer.action === "decline" || answer.action === "cancel") {
      return this.broker.reject(requestId);
    }
    return false;
  }

  private resolveQuestion(
    requestId: string,
    answer: InteractionAnswer,
  ): boolean {
    const pending = this.questions.get(requestId);
    if (!pending) {
      return false;
    }
    let value: string | undefined;
    let isCustomAnswer = false;
    let answers: QuizItemAnswer[] | undefined;
    if (answer.freeText !== undefined) {
      value = answer.freeText;
      isCustomAnswer = true;
      answers = this.assignAnswers(pending.questions, 0, value, true);
    } else if (answer.optionId !== undefined) {
      const choice = choiceForQuestions(pending.questions, answer.optionId);
      value = choice?.value ?? answer.optionId;
      isCustomAnswer = choice === undefined;
      answers = this.assignAnswers(
        pending.questions,
        choice?.index ?? 0,
        value,
        isCustomAnswer,
        choice && pending.questions[choice.index]?.multiSelect === true
          ? [choice.value]
          : undefined,
      );
    } else if (answer.action === "decline" || answer.action === "cancel") {
      value = "";
      answers = this.assignAnswers(pending.questions, -1, "", false);
    } else if (answer.action === "accept") {
      answers = answersFromContent(pending.questions, answer.content);
      value = answers
        ? formatQuizAnswer(pending.questions, answers)
        : answerFromContent(answer.content);
      isCustomAnswer = true;
    }
    if (value === undefined) {
      return false;
    }
    return this.broker.answerQuestion(
      requestId,
      value,
      isCustomAnswer,
      answers,
    );
  }

  /** One question's answer; -1 fills every question with an empty answer. */
  private assignAnswers(
    questions: QuizQuestion[],
    index: number,
    value: string,
    isCustomAnswer: boolean,
    selected?: string[],
  ): QuizItemAnswer[] {
    return questions.map((question, questionIndex) =>
      questionIndex === index
        ? {
            question: question.question,
            answer: value,
            isCustomAnswer,
            ...(selected && selected.length > 0 ? { selected } : {}),
          }
        : { question: question.question, answer: "", isCustomAnswer: false },
    );
  }

  private recordPermissionResolved(
    pending: PendingPermission,
    requestId: string,
    event: Record<string, unknown>,
  ): void {
    if (this.disposed) {
      return;
    }
    const sessionId = pending.sessionId ?? this.resolveSessionId();
    if (!sessionId) {
      return;
    }
    if (this.hasPermissionResolved(sessionId, requestId)) {
      return;
    }
    this.runtimes.append(
      sessionId,
      "permission.resolved",
      {
        requestId,
        toolCallId: pending.toolCallId ?? requestId,
        ...(typeof event.approved === "boolean"
          ? { decision: event.approved ? "allow" : "deny" }
          : {}),
      },
      Date.now(),
      pending.turnId,
    );
  }

  private hasPermissionResolved(sessionId: string, requestId: string): boolean {
    return this.runtimes
      .eventsAfter(sessionId, 0)
      .some(
        (event) =>
          event.type === "permission.resolved" &&
          asRecord(
            "payload" in event
              ? (event as { payload?: unknown }).payload
              : null,
          ).requestId === requestId,
      );
  }

  private recordResolved(pending: PendingQuestion, answer: unknown): void {
    if (this.disposed) {
      return;
    }
    const sessionId = pending.sessionId ?? this.resolveSessionId();
    if (!sessionId) {
      return;
    }
    if (
      this.hasQuestionEvent(sessionId, "userInput.resolved", pending.requestId)
    ) {
      return;
    }
    this.runtimes.append(
      sessionId,
      "userInput.resolved",
      {
        requestId: pending.requestId,
        cancelled: false,
        ...(typeof answer === "string" ? { value: answer } : {}),
      },
      Date.now(),
      pending.turnId,
    );
  }

  /**
   * True when the session event already exists. An in-process webui publishes
   * the same prompt on the agent event bus, whose turn handler appends the
   * translated event first; the bridge must not append a second one.
   */
  private hasQuestionEvent(
    sessionId: string,
    type: "userInput.requested" | "userInput.resolved",
    requestId: string,
  ): boolean {
    return this.runtimes
      .eventsAfter(sessionId, 0)
      .some(
        (event) =>
          event.type === type &&
          asRecord(
            "payload" in event
              ? (event as { payload?: unknown }).payload
              : null,
          ).requestId === requestId,
      );
  }

  private respond(requestId: string, result: unknown): void {
    void this.sender.respond(requestId, result).catch((error: unknown) => {
      logger.debug("AppServer: interaction response delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
