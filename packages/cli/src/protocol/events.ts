/**
 * The engine's output vocabulary. A surface renders these events; it does not
 * receive engine internals. This module has no dependency on the stream, the
 * UI, or the service container.
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
