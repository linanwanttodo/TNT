import type { ChatHistoryItem } from "core/index.js";

import { publishAgentEvent } from "../protocol/eventBus.js";
import { ROOT_REALM, realmTree, type RealmId } from "../realm/realmTree.js";
import type { ModelServiceState } from "../services/types.js";
import {
  loadSessionById,
  saveSubagentSession,
  updateSubagentSession,
} from "../session/index.js";
import { logger } from "../utils/logger.js";

import { currentDispatchScope } from "./dispatchScope.js";
import { executeSubAgent, type SubAgentResult } from "./executor.js";
import type { AgentRunContext } from "./runContext.js";
import { canControlSubagentSession } from "./runtime/authorization.js";
import {
  clearSubagentRuns,
  createSubagentRun,
  findSubagentRunBySessionId,
  getSubagentRun,
  updateSubagentRun,
  type SubagentRun,
  type SubagentRuntimeConfig,
} from "./runtime/spawner.js";

export { getSubagentRun, listSubagentRuns } from "./runtime/spawner.js";

export interface AsyncSubAgentOptions extends SubagentRuntimeConfig {
  agent: ModelServiceState;
  prompt: string;
  parentSessionId: string;
  abortController: AbortController;
  parentContext?: AgentRunContext;
  maxDelegationDepth?: number;
  asTeamMember?: boolean;
  memberTimeoutMs?: number;
  onOutputUpdate?: (output: string) => void;
  teamRunId?: string;
}

export interface AsyncSubAgentDispatchResult {
  runId: string;
  sessionId: string;
  realmId: RealmId;
  status: SubagentRun["status"];
}

export interface ResumeSubagentOptions extends SubagentRuntimeConfig {
  agent: ModelServiceState;
  parentSessionId: string;
  parentContext?: AgentRunContext;
  maxDelegationDepth?: number;
  memberTimeoutMs?: number;
  teamRunId?: string;
  requesterSessionId?: string;
}

const executionChains = new Map<string, Promise<void>>();
const parentAbortCleanups = new Map<string, () => void>();

function enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
  const previous = executionChains.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  executionChains.set(sessionId, next);
  void next
    .finally(() => {
      if (executionChains.get(sessionId) === next) {
        executionChains.delete(sessionId);
      }
    })
    .catch(() => undefined);
  return next;
}

function childAbortController(parent: AbortController): {
  controller: AbortController;
  detach: () => void;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent.signal.aborted) {
    controller.abort();
  } else {
    parent.signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    controller,
    detach: () => parent.signal.removeEventListener("abort", onAbort),
  };
}

function publishCompletion(run: SubagentRun, result: SubAgentResult): void {
  const summary = result.success
    ? result.response.slice(0, 1000)
    : (result.error ?? "Subagent failed.");
  const outcome =
    run.status === "cancelled"
      ? "cancelled"
      : result.success
        ? "finished"
        : "failed";
  publishAgentEvent({
    type: "notice",
    sessionId: run.parentSessionId,
    turnId: run.runId,
    seq: 2,
    timestamp: Date.now(),
    message: `Subagent ${run.agentType} (${run.sessionId}) ${outcome}.\n${summary}\nUse TaskOutput for the full report.`,
  });
}

function publishSteer(run: SubagentRun, message: string): void {
  publishAgentEvent({
    type: "subagent.steered",
    sessionId: run.parentSessionId,
    turnId: run.runId,
    seq: 1,
    timestamp: Date.now(),
    agentName: run.agentType,
    childSessionId: run.sessionId,
    content: message,
  });
}

function userMessage(content: string): ChatHistoryItem {
  return { message: { role: "user", content }, contextItems: [] };
}

function loadedHistory(sessionId: string): ChatHistoryItem[] {
  return (loadSessionById(sessionId)?.history ?? []).map((item) => ({
    ...item,
    message: { ...item.message },
    contextItems: [...(item.contextItems ?? [])],
  }));
}

function persistHistory(sessionId: string, history: ChatHistoryItem[]): void {
  updateSubagentSession({ sessionId, history });
}

function consumePendingMessages(
  sessionId: string,
  history: ChatHistoryItem[],
): { history: ChatHistoryItem[]; consumed: number } {
  const pending = loadSessionById(sessionId)?.pendingSubagentMessages ?? [];
  if (pending.length === 0) return { history, consumed: 0 };
  const nextHistory = [...history, ...pending.map(userMessage)];
  updateSubagentSession({
    sessionId,
    history: nextHistory,
    pendingMessages: [],
  });
  return { history: nextHistory, consumed: pending.length };
}

function persistPendingMessage(sessionId: string, message: string): void {
  const session = loadSessionById(sessionId);
  if (!session) return;
  updateSubagentSession({
    sessionId,
    history: session.history,
    pendingMessages: [...(session.pendingSubagentMessages ?? []), message],
  });
}

function isCancelled(run: SubagentRun): boolean {
  return run.status === "cancelled";
}

async function startRun(
  run: SubagentRun,
  history: ChatHistoryItem[],
  memberTimeoutMs?: number,
  onOutputUpdate?: (output: string) => void,
): Promise<void> {
  if (isCancelled(run)) return;
  const admitted = consumePendingMessages(run.sessionId, history);
  history = admitted.history;
  run.pendingMessages.splice(0);
  updateSubagentRun(run.runId, { status: "running" });
  let lastPersist = 0;
  const lastContent = history.at(-1)?.message.content;
  try {
    const result = await executeSubAgent({
      agent: run.agent,
      prompt: typeof lastContent === "string" ? lastContent : run.agentType,
      parentSessionId: run.parentSessionId,
      abortController: run.abortController,
      parentContext: run.parentContext,
      maxDelegationDepth: run.maxDelegationDepth,
      memberTimeoutMs,
      childSessionId: run.sessionId,
      initialHistory: history,
      runtime: run,
      realmId: run.realmId,
      ...run.config,
      onOutputUpdate,
      onHistoryUpdate: (nextHistory) => {
        const now = Date.now();
        if (now - lastPersist < 250) return;
        lastPersist = now;
        persistHistory(run.sessionId, nextHistory);
      },
    });
    if (run.status === "waiting_input" || isCancelled(run)) return;

    if (run.pendingMessages.length > 0) {
      const pending = run.pendingMessages.splice(0);
      const admitted = consumePendingMessages(
        run.sessionId,
        loadedHistory(run.sessionId),
      );
      const nextHistory =
        admitted.consumed > 0
          ? admitted.history
          : [...admitted.history, ...pending.map(userMessage)];
      await startRun(run, nextHistory, memberTimeoutMs, onOutputUpdate);
      return;
    }

    updateSubagentRun(run.runId, {
      status: result.success ? "done" : "failed",
      result,
    });
    publishCompletion(run, result);
  } catch (error) {
    logger.error("Asynchronous subagent run failed", error);
    if (run.status !== "waiting_input" && !isCancelled(run)) {
      const result: SubAgentResult = {
        success: false,
        response: "",
        error: error instanceof Error ? error.message : String(error),
      };
      updateSubagentRun(run.runId, { status: "failed", result });
      publishCompletion(run, result);
    }
  } finally {
    parentAbortCleanups.get(run.runId)?.();
    parentAbortCleanups.delete(run.runId);
  }
}

function resumedRuntimeConfig(
  options: ResumeSubagentOptions,
  existing?: SubagentRun,
): SubagentRuntimeConfig {
  return {
    maxTurns: options.maxTurns ?? existing?.config?.maxTurns,
    allowedTools: options.allowedTools ?? existing?.config?.allowedTools,
    permissionMode: options.permissionMode ?? existing?.config?.permissionMode,
    skills: options.skills ?? existing?.config?.skills,
    isolation: options.isolation ?? existing?.config?.isolation,
  };
}

export async function dispatchSubAgent(
  options: AsyncSubAgentOptions,
): Promise<AsyncSubAgentDispatchResult> {
  const ambient = currentDispatchScope();
  const parent = options.parentContext ?? ambient?.context;
  const parentDepth = parent?.delegationDepth ?? 0;
  const childDepth = Math.min(
    parentDepth + 1,
    options.maxDelegationDepth ?? ambient?.maxDelegationDepth ?? 3,
  );
  const history = [userMessage(options.prompt)];
  const child = saveSubagentSession({
    parentSessionId: options.parentSessionId,
    subagentType: options.agent.model?.name ?? "agent",
    history,
    delegationDepth: childDepth,
  });
  const parentRealm =
    (parent as { realmId?: RealmId } | undefined)?.realmId ?? ROOT_REALM;
  const realmId = realmTree.fork(parentRealm);
  const abort = childAbortController(options.abortController);
  const run = createSubagentRun({
    sessionId: child.sessionId,
    parentSessionId: options.parentSessionId,
    realmId,
    agent: options.agent,
    parentContext: parent,
    maxDelegationDepth: options.maxDelegationDepth,
    config: {
      maxTurns: options.maxTurns,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      skills: options.skills,
      isolation: options.isolation,
    },
    abortController: abort.controller,
    parentAbortController: options.abortController,
    teamRunId: options.teamRunId,
  });
  parentAbortCleanups.set(run.runId, abort.detach);
  updateSubagentRun(run.runId, { status: "running" });
  void enqueue(run.sessionId, () =>
    startRun(run, history, options.memberTimeoutMs, options.onOutputUpdate),
  );
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    realmId,
    status: "running",
  };
}

export async function resumeSubagentRun(
  sessionId: string,
  message: string,
  options: ResumeSubagentOptions,
): Promise<AsyncSubAgentDispatchResult | undefined> {
  const content = message.trim();
  if (!content) return undefined;
  const existing = findSubagentRunBySessionId(sessionId);
  const target = loadSessionById(sessionId);
  const requester = options.requesterSessionId
    ? loadSessionById(options.requesterSessionId)
    : undefined;
  if (
    !canControlSubagentSession(
      target,
      options.parentSessionId,
      options.requesterSessionId,
      requester,
    )
  ) {
    return undefined;
  }
  const history = loadedHistory(sessionId);
  persistPendingMessage(sessionId, content);

  if (
    existing &&
    (existing.status === "running" || existing.status === "waiting_input")
  ) {
    existing.pendingMessages.push(content);
    if (existing.status === "waiting_input") {
      updateSubagentRun(existing.runId, { status: "pending" });
      void enqueue(sessionId, async () => {
        const abort = childAbortController(existing.parentAbortController);
        updateSubagentRun(existing.runId, {
          abortController: abort.controller,
        });
        parentAbortCleanups.set(existing.runId, abort.detach);
        await startRun(existing, history, options.memberTimeoutMs);
      });
    }
    publishSteer(existing, content);
    return {
      runId: existing.runId,
      sessionId,
      realmId: existing.realmId,
      status: existing.status,
    };
  }

  const ambient = currentDispatchScope();
  const parent = options.parentContext ?? ambient?.context;
  const parentRealm =
    (parent as { realmId?: RealmId } | undefined)?.realmId ?? ROOT_REALM;
  const parentAbort = new AbortController();
  const abort = childAbortController(parentAbort);
  const run = createSubagentRun({
    sessionId,
    parentSessionId: target.parentSessionId,
    realmId: existing?.realmId ?? realmTree.fork(parentRealm),
    agent: options.agent,
    parentContext: parent,
    maxDelegationDepth: options.maxDelegationDepth,
    config: resumedRuntimeConfig(options, existing),
    abortController: abort.controller,
    parentAbortController: parentAbort,
    teamRunId: options.teamRunId ?? existing?.teamRunId,
  });
  parentAbortCleanups.set(run.runId, abort.detach);
  publishSteer(run, content);
  void enqueue(sessionId, () =>
    startRun(run, history, options.memberTimeoutMs),
  );
  return {
    runId: run.runId,
    sessionId,
    realmId: run.realmId,
    status: "running",
  };
}

export function stopSubagentRun(
  runId: string,
  parentSessionId?: string,
): boolean {
  const run = getSubagentRun(runId);
  if (!run || (parentSessionId && run.parentSessionId !== parentSessionId)) {
    return false;
  }
  if (
    run.status === "done" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return false;
  }
  const result: SubAgentResult = {
    success: false,
    response: "",
    error: "Subagent cancelled by user.",
  };
  updateSubagentRun(run.runId, { status: "cancelled", result });
  run.abortController.abort();
  publishAgentEvent({
    type: "subagent.finished",
    sessionId: run.parentSessionId,
    turnId: run.runId,
    seq: 3,
    timestamp: Date.now(),
    agentName: run.agentType,
    childSessionId: run.sessionId,
    content: result.error ?? "Subagent cancelled by user.",
    success: false,
    cancelled: true,
  });
  publishCompletion(run, result);
  return true;
}

export function clearAsyncSubagentRuns(): void {
  clearSubagentRuns();
  executionChains.clear();
  parentAbortCleanups.clear();
}

export type { SubAgentResult };
