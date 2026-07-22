/**
 * The engine's output vocabulary. A surface renders these events; it does not
 * receive engine internals. This module has no dependency on the stream, the
 * UI, or the service container.
 */

import type { Usage } from "core/index.js";

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
        /** The input this turn answers, when the surface should show it. */
        userInput?: string;
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
    | {
        type: "turn.completed";
        content?: string;
        /** The turn's own usage, when the producer knows it. */
        usage?: Usage;
        /** Whole-turn ledger: every round summed, for the completion notice. */
        turnTotals?: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cost: number;
          rounds: number;
        };
      }
    | { type: "turn.failed"; message: string }
    | {
        type: "turn.interrupted";
        reason: string;
        notice?: string;
        /** The turn's own usage, when the producer knows it. */
        usage?: Usage;
        /** Whole-turn ledger up to the interruption. */
        turnTotals?: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cost: number;
          rounds: number;
        };
      }
    | { type: "queue.changed"; length: number }
    | { type: "session.changed"; sessionId: string }
    | {
        type: "subagent.started";
        agentName: string;
        prompt: string;
        /**
         * The child session created before the run starts. A running dispatch
         * can then be inspected instead of pointing at an empty transcript.
         */
        childSessionId?: string;
      }
    | {
        type: "subagent.reported";
        agentName: string;
        content: string;
      }
    | {
        type: "subagent.finished";
        agentName: string;
        content: string;
        success: boolean;
        /** A user stop aborted the run; the member is cancelled, not failed. */
        cancelled?: boolean;
        verdict?: string;
      }
    /** The chat model this process now runs. */
    | { type: "model.changed"; model: string }
    /** The checkout the session now works in. */
    | { type: "workspace.changed"; path: string; branch: string | null }
  );

export type AgentEventType = AgentEvent["type"];

/** The payload before the envelope is stamped; distributive over the union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type AgentEventInput = DistributiveOmit<
  AgentEvent,
  keyof AgentEventBase
>;

/**
 * Stamps events with the turn identity and a sequence number. Events sharing a
 * turn are totally ordered; a late event is recognizable by its seq rather than
 * by its arrival time.
 */
export function createEventSequence(
  sessionId: string,
  turnId: string,
  now: () => number = Date.now,
): {
  next: (event: AgentEventInput) => AgentEvent;
  lastSeq: () => number;
} {
  let seq = 0;

  return {
    next: (event) => {
      seq += 1;
      return {
        ...event,
        sessionId,
        turnId,
        seq,
        timestamp: now(),
      } as AgentEvent;
    },
    lastSeq: () => seq,
  };
}

/** Drops an event a surface has already passed, keeping the watermark. */
export class EventGate {
  private seen = new Map<string, number>();

  accept(event: AgentEvent): boolean {
    const last = this.seen.get(event.turnId) ?? 0;
    if (event.seq <= last) {
      return false;
    }
    this.seen.set(event.turnId, event.seq);
    return true;
  }
}
