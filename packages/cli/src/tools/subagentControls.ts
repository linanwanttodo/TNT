import { t } from "../i18n/index.js";
import { services } from "../services/index.js";
import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES, type ModelServiceState } from "../services/types.js";
import { loadSessionById } from "../session/index.js";
import {
  listSubagentRuns,
  resumeSubagentRun,
  stopSubagentRun,
} from "../subagent/asyncExecutor.js";
import { currentDispatchScope } from "../subagent/dispatchScope.js";
import {
  SEND_MESSAGE_TOOL_META,
  TASK_OUTPUT_TOOL_META,
  TASK_STOP_TOOL_META,
} from "../subagent/index.js";
import { canControlSubagentSession } from "../subagent/runtime/authorization.js";
import { readSubagentTranscript } from "../subagent/runtime/injector.js";
import { requestParentInput } from "../subagent/runtime/pingHandler.js";
import type { SubagentRun } from "../subagent/runtime/spawner.js";
import { shareTeamBrief } from "../team/intercom.js";

import { resolveAgentState } from "./subagent.js";
import type { Tool } from "./types.js";

function parentSessionId(): string {
  const id = services.chatHistory.getSessionId();
  if (!id) throw new Error(t("tools.noActiveParentSession"));
  return id;
}

function findRun(
  parent: string,
  runId?: string,
  sessionId?: string,
  requester?: SubagentRun,
): SubagentRun | undefined {
  const matches = (run: SubagentRun) =>
    (runId !== undefined && run.runId === runId) ||
    (sessionId !== undefined && run.sessionId === sessionId);
  const direct = listSubagentRuns(parent).find(matches);
  if (direct || !requester) return direct;
  return listSubagentRuns(requester.parentSessionId).find(
    (run) =>
      run.runId !== requester.runId &&
      Boolean(run.teamRunId) &&
      run.teamRunId === requester.teamRunId &&
      matches(run),
  );
}

export const taskOutputTool: Tool = {
  ...TASK_OUTPUT_TOOL_META,
  run: async (args: {
    run_id?: string;
    session_id?: string;
    include_transcript?: boolean;
  }) => {
    const parent = parentSessionId();
    const selected = findRun(parent, args.run_id, args.session_id);
    if (!selected && !args.run_id && !args.session_id) {
      const live = listSubagentRuns(parent);
      if (live.length === 0) return "No delegated runs for this session.";
      return live
        .map(
          (run) =>
            `${run.runId}\t${run.sessionId}\t${run.agentType}\t${run.status}`,
        )
        .join("\n");
    }
    if (!selected) {
      const transcript = args.session_id
        ? readSubagentTranscript(args.session_id, parent)
        : null;
      if (!transcript)
        return `Delegated run not found or not owned by this session: ${args.run_id ?? args.session_id}`;
      return JSON.stringify(transcript, null, 2);
    }
    const result = selected.result;
    const lines = [
      `run_id: ${selected.runId}`,
      `session_id: ${selected.sessionId}`,
      `agent: ${selected.agentType}`,
      `status: ${selected.status}`,
      ...(result?.response ? [`report:\n${result.response}`] : []),
      ...(result?.error ? [`error: ${result.error}`] : []),
    ];
    if (args.include_transcript) {
      const transcript = readSubagentTranscript(selected.sessionId, parent);
      lines.push(
        `transcript:\n${JSON.stringify(transcript?.messages ?? [], null, 2)}`,
      );
    }
    return lines.join("\n");
  },
};

export const taskStopTool: Tool = {
  ...TASK_STOP_TOOL_META,
  run: async ({ run_id }: { run_id: string }) => {
    if (!run_id) return "TaskStop needs a run_id.";
    return stopSubagentRun(run_id, parentSessionId())
      ? `Stopped delegated run ${run_id}.`
      : `Delegated run ${run_id} is not running.`;
  },
};

async function resumeChild(
  sessionId: string,
  message: string,
  known?: SubagentRun,
): Promise<string> {
  const parent = parentSessionId();
  const ambient = currentDispatchScope();
  const child = loadSessionById(sessionId);
  if (!child?.subagentType) return `Child session not found: ${sessionId}`;
  if (
    !canControlSubagentSession(
      child,
      parent,
      ambient?.runtime?.sessionId,
      ambient?.runtime
        ? {
            parentSessionId: ambient.runtime.parentSessionId,
            subagentType: ambient.runtime.agentType,
          }
        : undefined,
    )
  ) {
    return `Child session not found or not owned by this session: ${sessionId}`;
  }
  let agent = known?.agent;
  if (!agent) {
    const state = await serviceContainer.get<ModelServiceState>(
      SERVICE_NAMES.MODEL,
    );
    agent = resolveAgentState(child.subagentType, state) ?? undefined;
  }
  if (!agent) return `Could not resolve agent for child session ${sessionId}.`;
  const resumed = await resumeSubagentRun(sessionId, message, {
    agent,
    parentSessionId: known?.parentSessionId ?? child.parentSessionId,
    parentContext: known?.parentContext ?? ambient?.context,
    maxDelegationDepth: known?.maxDelegationDepth,
    memberTimeoutMs: undefined,
    requesterSessionId: ambient?.runtime?.sessionId,
  });
  return resumed
    ? `Message sent to ${sessionId} (run ${resumed.runId}, status ${resumed.status}).`
    : `Could not resume child session ${sessionId}.`;
}

async function shareBrief(input: {
  teamRunId: string;
  from: string;
  to: string;
  type: "task" | "question" | "sync" | "verdict";
  content: string;
  sender?: SubagentRun;
}): Promise<string> {
  const brief = shareTeamBrief(input);
  if (!brief) return "Team run is not active or the brief is empty.";
  const recipients = listSubagentRuns(input.sender?.parentSessionId).filter(
    (run) =>
      run.teamRunId === input.teamRunId &&
      run.runId !== input.sender?.runId &&
      (input.to === "team" || run.agentType === input.to),
  );
  await Promise.all(
    recipients.map((run) =>
      resumeChild(
        run.sessionId,
        `Team brief from ${brief.from}:\n${brief.content}`,
        run,
      ),
    ),
  );
  return `Brief shared with ${input.to}.`;
}

export const sendMessageTool: Tool = {
  ...SEND_MESSAGE_TOOL_META,
  run: async (args: {
    run_id?: string;
    session_id?: string;
    team_run_id?: string;
    recipient?: string;
    type?: "task" | "question" | "sync" | "verdict";
    message: string;
  }) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return "SendMessage needs a message.";
    const runtime = currentDispatchScope()?.runtime;
    const recipient = args.recipient?.trim() || "";

    if (runtime && recipient === "parent") {
      requestParentInput(runtime, message);
      return "Waiting for parent input. The parent can reply with SendMessage.";
    }

    const parent = parentSessionId();
    const hasDirectTarget = Boolean(args.run_id || args.session_id);
    const target = hasDirectTarget
      ? findRun(parent, args.run_id, args.session_id, runtime)
      : undefined;
    if (hasDirectTarget) {
      if (!target && !args.session_id) {
        return `Delegated run not found or not owned by this session: ${args.run_id}`;
      }
      const sessionId = target?.sessionId ?? args.session_id!;
      return resumeChild(sessionId, message, target);
    }

    const teamRunId = args.team_run_id ?? runtime?.teamRunId;
    if (teamRunId && (recipient === "team" || recipient === "")) {
      return shareBrief({
        teamRunId,
        from: runtime?.agentType ?? "parent",
        to: "team",
        type: args.type ?? "sync",
        content: message,
        sender: runtime,
      });
    }
    if (runtime && teamRunId && recipient) {
      return shareBrief({
        teamRunId,
        from: runtime.agentType,
        to: recipient,
        type: args.type ?? "sync",
        content: message,
        sender: runtime,
      });
    }
    return "SendMessage needs a child session or a team recipient.";
  },
};
