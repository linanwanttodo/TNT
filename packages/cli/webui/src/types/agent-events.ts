/**
 * The engine's output vocabulary, copied verbatim from
 * `packages/cli/src/protocol/events.ts` (the type is the contract; the webui
 * must stay decoupled from the CLI's module graph). Keep in sync.
 */

export type ToolStatusName =
  "generated" | "generating" | "calling" | "done" | "errored" | "canceled";

export interface AgentEventBase {
  sessionId: string;
  turnId: string;
  /** Monotonic within one turn; a surface drops an event below its watermark. */
  seq: number;
  timestamp: number;
}

export type AgentEvent = AgentEventBase &
  (
    | {
        type: "turn.started";
        model: string;
        historyLength: number;
      }
    | { type: "content.delta"; delta: string }
    | { type: "reasoning.delta"; delta: string }
    | {
        type: "tool.started";
        toolCallId?: string;
        toolName: string;
        args?: unknown;
      }
    | {
        type: "tool.updated";
        toolCallId?: string;
        toolName: string;
        status: ToolStatusName;
      }
    | {
        type: "tool.finished";
        toolCallId?: string;
        toolName: string;
        args?: unknown;
        status: ToolStatusName;
        result?: string;
      }
    | {
        type: "permission.requested";
        requestId: string;
        toolCallId?: string;
        toolName: string;
        toolArgs: unknown;
        preview?: unknown;
      }
    | {
        type: "question.requested";
        requestId: string;
        question: string;
        options?: readonly string[];
        defaultAnswer?: string;
      }
    | { type: "question.answered"; requestId: string }
    | { type: "notice"; message: string }
    | { type: "compaction.started" }
    | { type: "compaction.finished"; reductionRatio?: number }
    | { type: "turn.completed"; content?: string }
    | { type: "turn.failed"; message: string }
    | {
        type: "turn.interrupted";
        reason: string;
        notice?: string;
      }
    | { type: "queue.changed"; length: number }
    | { type: "session.changed"; sessionId: string }
    | { type: "model.changed"; model: string }
    | { type: "workspace.changed"; path: string; branch: string | null }
    | { type: "subagent.started"; agentName: string; prompt: string }
    | { type: "subagent.reported"; agentName: string; content: string }
    | {
        type: "subagent.finished";
        agentName: string;
        content: string;
        success: boolean;
        verdict?: string;
      }
  );

export type AgentEventType = AgentEvent["type"];

/** Webui-side shape of the /state response (GET /state in WebUiService). */
export interface StateSnapshot {
  session: {
    sessionId: string;
    title: string;
    history: unknown[];
    [key: string]: unknown;
  };
  isProcessing: boolean;
  messageQueueLength: number;
  pendingPermission: unknown;
  subagents?: SubagentState[];
}

export interface SubagentState {
  name: string;
  prompt: string;
  status: "running" | "finished";
  content?: string;
  success?: boolean;
  verdict?: string;
  /** Client-captured wall clock of the started event, for the directory. */
  startedAt?: number;
}
