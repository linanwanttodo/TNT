/* eslint-disable max-lines -- the dispatch lifecycle keeps start, failure and cancellation in one ordered flow */
import type { ChatHistoryItem } from "core";

import { fireSubagentStart, fireSubagentStop } from "../hooks/fireHook.js";
import { t } from "../i18n/index.js";
import { publishAgentEvent } from "../protocol/eventBus.js";
import { type AgentEvent, type AgentEventInput } from "../protocol/events.js";
import { services } from "../services/index.js";
import { ModelServiceState } from "../services/types.js";
import { runAgentTurn } from "../session/controller.js";
import {
  finishTeamMemberRun,
  getCurrentSession,
  getCurrentTeamRunMember,
  getSessionActiveTeam,
  saveSubagentSession,
  startTeamMemberRun,
  updateSubagentSession,
} from "../session/index.js";
import { loadTeams } from "../team/loader.js";
import { escapeEvents } from "../utils/cli.js";
import { logger } from "../utils/logger.js";

import {
  canDelegate,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  delegationDepthOf,
  resolveChildDepth,
} from "./depth.js";
import { currentDispatchScope, runInDispatchScope } from "./dispatchScope.js";
import { resolveDispatchableAgent } from "./get-agents.js";
import {
  acquireTeamMemberSlot,
  releaseTeamMemberSlot,
} from "./memberLimiter.js";
import { createChildContext, type AgentRunContext } from "./runContext.js";
import { type SubAgentVerdict, parseVerdict } from "./verdict.js";

/**
 * A team member gets a wall-clock budget because a lead may dispatch several
 * in parallel and a hung member would otherwise hold the lead open forever.
 * Fifteen minutes is long enough for a real implement-and-test cycle and short
 * enough that a stuck provider surfaces in the same conversation.
 */
export const DEFAULT_TEAM_MEMBER_TIMEOUT_MS = 15 * 60 * 1000;

export function teamMemberTimeoutMs(): number {
  const raw = process.env.TNT_TEAM_MEMBER_TIMEOUT_MS;
  const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TEAM_MEMBER_TIMEOUT_MS;
}

/**
 * Options for executing a subagent
 */
export interface SubAgentExecutionOptions {
  agent: ModelServiceState;
  prompt: string;
  parentSessionId: string;
  abortController: AbortController;
  onOutputUpdate?: (output: string) => void;
  /**
   * Run context for the parent. When omitted, the enclosing delegated run's
   * context is used if there is one, so a dispatched member inherits the
   * lead's depth instead of looking like a fresh top-level dispatch.
   */
  parentContext?: AgentRunContext;
  maxDelegationDepth?: number;
  /** Test seam for the per-member wall-clock budget. */
  memberTimeoutMs?: number;
}

/**
 * Result from executing a subagent
 */
export interface SubAgentResult {
  success: boolean;
  response: string;
  error?: string;
  /**
   * Set when the agent's report ends in a verdict line, which is how a
   * delegated check reports its finding without the caller re-reading prose.
   */
  verdict?: SubAgentVerdict;
}

/**
 * Build system message for the agent
 */
async function buildAgentSystemMessage(
  agent: ModelServiceState,
  mode: string,
  dispatchablePrompt?: string,
): Promise<string> {
  const baseMessage = services.systemMessage
    ? await services.systemMessage.getSystemMessage(mode as any)
    : "";

  // A configured model agent carries its prompt on the entry itself; a team
  // member or a plugin agent has none there - the dispatch chain resolved
  // their persona instead.
  const agentPrompt =
    agent.model?.chatOptions?.baseSystemMessage || dispatchablePrompt || "";

  // Combine base system message with agent-specific prompt
  if (agentPrompt) {
    return `${baseMessage}\n\n${agentPrompt}`;
  }

  return baseMessage;
}

/** The model id the dispatch actually runs on, for the run ledger. */
function resolvedModelLabel(agent: ModelServiceState): string | undefined {
  return agent.model?.model ?? agent.model?.name;
}

function resolveParentAndDepth(
  options: SubAgentExecutionOptions,
  ambient: ReturnType<typeof currentDispatchScope>,
  abortController: AbortController,
): { resolvedParent: AgentRunContext; maxDelegationDepth: number } {
  const maxDelegationDepth =
    options.maxDelegationDepth ??
    ambient?.maxDelegationDepth ??
    DEFAULT_MAX_SUBAGENT_DEPTH;

  const resolvedParent =
    options.parentContext ??
    ambient?.context ??
    ({
      id: options.parentSessionId,
      parentContext: undefined,
      delegationDepth: delegationDepthOf(getCurrentSession()),
      systemMessage: "",
      permissions: services.toolPermissions.getState().permissions,
      mode: services.toolPermissions.getState().currentMode,
      abortSignal: abortController.signal,
    } satisfies AgentRunContext);

  return { resolvedParent, maxDelegationDepth };
}

/**
 * A member gets its own abort handle so its timeout or an escape stops that
 * member without cancelling the lead. Any other dispatch shares the caller's
 * controller, as before.
 */
function createRunAbortController(
  base: AbortController,
  isolated: boolean,
): { controller: AbortController; detach: () => void } {
  if (!isolated) {
    return { controller: base, detach: () => undefined };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (base.signal.aborted) {
    controller.abort();
  } else {
    base.signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    controller,
    detach: () => base.signal.removeEventListener("abort", onAbort),
  };
}

/**
 * Bound one member turn by wall-clock time. The race settles even if the
 * provider never does; the abort asks the engine to stop, and a rejection that
 * arrives after the race is already handled by it.
 */
async function runTurnWithTimeout(
  runTurn: () => Promise<unknown>,
  controller: AbortController,
  agentType: string,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          t("subagent.teamMemberTimeout", {
            name: agentType,
            minutes: Math.max(1, Math.round(timeoutMs / 60_000)),
          }),
        ),
      );
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    await Promise.race([runTurn(), timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface MemberBookkeeping {
  memberFinished: boolean;
}

/** The host notice a stop leaves in the child transcript. */
const CANCELLED_NOTICE = "Subagent execution was cancelled by the user.";

/**
 * Throw the abort shape the catch path recognizes as a cancellation. A run
 * that returns after the parent aborted must not be recorded as a success.
 */
function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  const abort = new Error(CANCELLED_NOTICE);
  abort.name = "AbortError";
  throw abort;
}

function beginSubagentDispatch(options: {
  parentSessionId: string;
  agentType: string;
  prompt: string;
  chatHistory: ChatHistoryItem[];
  childDepth: number;
  emit: (event: AgentEventInput) => void;
}): string {
  const child = saveSubagentSession({
    parentSessionId: options.parentSessionId,
    subagentType: options.agentType,
    history: options.chatHistory,
    delegationDepth: options.childDepth,
  });
  options.emit({
    type: "subagent.started",
    agentName: options.agentType,
    prompt: options.prompt,
    ...(child.sessionId ? { childSessionId: child.sessionId } : {}),
  });
  return child.sessionId;
}

/** Saves the child session, settles the ledger and publishes the success events. */
async function completeChildRun(options: {
  chatHistory: ChatHistoryItem[];
  modelName: string;
  agentId: string;
  agentType: string;
  parentSessionId: string;
  childDepth: number;
  /** The session created at dispatch start; updated, never recreated. */
  childSessionId?: string;
  teamMember: { runId: string } | undefined;
  bookkeeping: MemberBookkeeping;
  emit: (event: AgentEventInput) => void;
}): Promise<string> {
  // The last message (mostly) contains the important output to be submitted
  // back to the main agent.
  const lastMessage = options.chatHistory.at(-1);
  const response =
    typeof lastMessage?.message?.content === "string"
      ? lastMessage.message.content
      : "";

  logger.debug("Subagent execution completed", {
    agent: options.modelName,
    responseLength: response.length,
  });

  let child = options.childSessionId
    ? updateSubagentSession({
        sessionId: options.childSessionId,
        history: options.chatHistory,
      })
    : null;
  if (!child) {
    // A missing child means the start save never landed; create it rather than
    // leaving the dispatch without a transcript.
    child = saveSubagentSession({
      parentSessionId: options.parentSessionId,
      subagentType: options.agentType,
      history: options.chatHistory,
      delegationDepth: options.childDepth,
    });
  }
  const childSessionId = child.sessionId;

  if (options.teamMember) {
    finishTeamMemberRun(options.teamMember.runId, options.agentType, {
      success: true,
      subagentSessionId: childSessionId,
      report: response,
    });
    options.bookkeeping.memberFinished = true;
  }

  await fireSubagentStop(options.agentId, options.agentType, response).catch(
    () => {},
  );

  options.emit({
    type: "subagent.reported",
    agentName: options.agentType,
    content: response,
  });
  const verdict = parseVerdict(response);
  options.emit({
    type: "subagent.finished",
    agentName: options.agentType,
    content: response,
    success: true,
    ...(verdict ? { verdict: verdict as string } : {}),
  });

  return response;
}

/** Logs the failure and closes the member ledger and lifecycle it left open. */
function recordChildFailure(options: {
  error: unknown;
  agentName: string;
  nextSeq: number;
  /** True when the parent's controller was aborted, i.e. a user stop. */
  cancelled: boolean;
  childSessionId?: string;
  chatHistory?: ChatHistoryItem[];
  teamMember: { runId: string } | undefined;
  bookkeeping: MemberBookkeeping;
  emit: (event: AgentEventInput) => void;
}): void {
  const message = options.cancelled
    ? CANCELLED_NOTICE
    : options.error instanceof Error
      ? options.error.message
      : String(options.error);

  logger.error("Subagent execution failed", {
    agent: options.agentName,
    cancelled: options.cancelled,
    error: message,
  });

  // Persist the transcript the run actually produced, including the terminal
  // notice, so a failed dispatch still has a real child session behind it.
  if (options.childSessionId && options.chatHistory) {
    updateSubagentSession({
      sessionId: options.childSessionId,
      history: options.chatHistory,
      notice: options.cancelled
        ? CANCELLED_NOTICE
        : `Subagent execution failed: ${message}`,
    });
  }

  if (options.teamMember && !options.bookkeeping.memberFinished) {
    finishTeamMemberRun(options.teamMember.runId, options.agentName, {
      success: false,
      cancelled: options.cancelled,
      subagentSessionId: options.childSessionId,
      error: message,
    });
    options.bookkeeping.memberFinished = true;
  }

  // The catch may fire before the started event existed (model resolution
  // failed); only a begun lifecycle gets a finished event.
  if (options.nextSeq > 0) {
    options.emit({
      type: "subagent.finished",
      agentName: options.agentName,
      content: message,
      success: false,
      ...(options.cancelled ? { cancelled: true } : {}),
    });
  }
}

/**
 * Execute a subagent in a child session
 */

export async function executeSubAgent(
  options: SubAgentExecutionOptions,
): Promise<SubAgentResult> {
  const {
    agent: subAgent,
    prompt,
    abortController,
    onOutputUpdate,
    parentContext,
  } = options;

  // Delegation lives on the agent event bus too, so a surface that is not the
  // caller (SSE) can follow the subagent's lifecycle. Events carry the parent
  // session id; the child turn's own controller events stay separate.
  let nextSeq = 0;
  const agentType = subAgent.model?.name ?? "agent";
  const emit = (event: AgentEventInput): void => {
    nextSeq += 1;
    publishAgentEvent({
      ...event,
      sessionId: options.parentSessionId,
      turnId: agentType,
      seq: nextSeq,
      timestamp: Date.now(),
    } as AgentEvent);
  };

  // A nested dispatch inherits the run that produced it. The explicit
  // parentContext wins, so the existing callers and tests keep their behavior.
  const ambient = parentContext ? undefined : currentDispatchScope();
  const teamMember = getCurrentTeamRunMember(agentType);
  let memberSlotHeld = false;
  const bookkeeping: MemberBookkeeping = { memberFinished: false };
  let detachAbort: (() => void) | undefined;
  // The initial transcript exists from dispatch start so a running child is
  // inspectable, and so a failure has a real transcript to persist.
  let chatHistory: ChatHistoryItem[] = [];
  let childSessionId: string | undefined;

  try {
    logger.debug("Starting subagent execution", {
      agent: subAgent.model?.name,
    });

    const { model, llmApi } = subAgent;
    if (!model || !llmApi) {
      throw new Error(t("subagent.modelUnavailable"));
    }

    chatHistory = [
      {
        message: {
          role: "user",
          content: prompt,
        },
        contextItems: [],
      },
    ] as ChatHistoryItem[];

    const { resolvedParent, maxDelegationDepth } = resolveParentAndDepth(
      options,
      ambient,
      abortController,
    );

    const childDepth = resolveChildDepth({
      delegationDepth: resolvedParent.delegationDepth,
      maxDelegationDepth,
    });

    const activeTeamName = getSessionActiveTeam();
    const activeTeam = activeTeamName
      ? loadTeams(process.cwd()).find((team) => team.name === activeTeamName)
      : undefined;
    const dispatchable = resolveDispatchableAgent(
      agentType,
      subAgent,
      activeTeam,
    );

    const systemMessage = await buildAgentSystemMessage(
      subAgent,
      resolvedParent.mode,
      dispatchable?.systemMessage,
    );

    const runAbort = createRunAbortController(
      abortController,
      Boolean(teamMember),
    );
    detachAbort = runAbort.detach;

    const childContext = createChildContext(resolvedParent, {
      id: `${resolvedParent.id}:${childDepth}:${agentType}`,
      delegationDepth: childDepth,
      systemMessage,
      abortSignal: runAbort.controller.signal,
      // A built-in role or a team member declares what it may not do; a plain
      // configured agent keeps whatever the session allowed, as it did before
      // this existed.
      restriction: dispatchable?.restriction,
      deniedTools: dispatchable?.deniedTools,
    });

    const agentId = childContext.id;

    // Queue behind the member concurrency cap before the run starts, so a
    // large roster cannot unpack into unbounded parallel work.
    if (teamMember) {
      await acquireTeamMemberSlot();
      memberSlotHeld = true;
      startTeamMemberRun(
        teamMember.runId,
        agentType,
        resolvedModelLabel(subAgent),
      );
    }

    // The child session is created at dispatch start, before the run: a
    // running dispatch then has a real transcript and id to drill into, and
    // the finish path updates this same session instead of creating another.
    childSessionId = beginSubagentDispatch({
      parentSessionId: options.parentSessionId,
      agentType,
      prompt,
      chatHistory,
      childDepth,
      emit,
    });

    await fireSubagentStart(agentId, agentType).catch(() => {});

    const escapeHandler = () => {
      abortController.abort();
      const alreadyNoted = chatHistory.some(
        (item) =>
          item.message.role === "user" &&
          item.message.content === CANCELLED_NOTICE,
      );
      if (!alreadyNoted) {
        chatHistory.push({
          message: {
            role: "user",
            content: CANCELLED_NOTICE,
          },
          contextItems: [],
        });
      }
    };

    escapeEvents.on("user-escape", escapeHandler);

    try {
      let accumulatedOutput = "";

      const runTurn = () =>
        runAgentTurn({
          chatHistory,
          model,
          llmApi,
          abortController: runAbort.controller,
          callbacks: {
            onContent: (content: string) => {
              accumulatedOutput += content;
              if (onOutputUpdate) {
                onOutputUpdate(accumulatedOutput);
              }
            },
            onToolResult: (result: string) => {
              // todo: skip tool outputs - show tool names and params
              accumulatedOutput += `\n\n${result}`;
              if (onOutputUpdate) {
                onOutputUpdate(accumulatedOutput);
              }
            },
          },
          runOverrides: {
            systemMessage: childContext.systemMessage,
            isHeadless: true,
            permissions: childContext.permissions,
            canDelegate: canDelegate({
              delegationDepth: childDepth,
              maxDelegationDepth,
            }),
          },
        });

      await runInDispatchScope(
        { context: childContext, maxDelegationDepth },
        async () => {
          if (!teamMember) {
            await runTurn();
            return;
          }

          await runTurnWithTimeout(
            runTurn,
            runAbort.controller,
            agentType,
            options.memberTimeoutMs ?? teamMemberTimeoutMs(),
          );
        },
      );

      // A run that returns after the parent was aborted still counts as a
      // cancellation: the user stopped it, even if the provider resolved.
      throwIfCancelled(abortController.signal);

      const response = await completeChildRun({
        chatHistory,
        modelName: model.name,
        agentId,
        agentType,
        parentSessionId: options.parentSessionId,
        childDepth,
        childSessionId,
        teamMember,
        bookkeeping,
        emit,
      });

      return {
        success: true,
        response,
        verdict: parseVerdict(response),
      };
    } finally {
      escapeEvents.removeListener("user-escape", escapeHandler);
    }
  } catch (error: any) {
    const cancelled =
      abortController.signal.aborted ||
      /cancelled by the user/i.test(
        error instanceof Error ? error.message : String(error),
      );
    recordChildFailure({
      error,
      agentName: agentType,
      nextSeq,
      cancelled,
      childSessionId,
      chatHistory,
      teamMember,
      bookkeeping,
      emit,
    });

    return {
      success: false,
      response: "",
      error: cancelled
        ? CANCELLED_NOTICE
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    if (memberSlotHeld) {
      releaseTeamMemberSlot();
    }
    detachAbort?.();
  }
}
