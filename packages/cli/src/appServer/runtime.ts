import type { ZCodeSessionEvent, ZCodeSessionEventType } from "@zcode/shared";

import type { AgentEvent } from "../protocol/events.js";

import {
  createTranslationState,
  stamp,
  translateAgentEvent,
  type TranslationState,
} from "./events.js";

const MAX_RETAINED_EVENTS = 2000;

export interface SessionRuntime {
  readonly state: TranslationState;
  readonly events: ZCodeSessionEvent[];
  readonly listeners: Set<(event: ZCodeSessionEvent) => void>;
}

export interface SessionRuntimeCursor {
  eventSeq: number;
  stateRevision: number;
}

/**
 * Per-session event log and seq authority. `eventSeq` is the cursor the client
 * persists for resume; `stateRevision` is the monotonic revision for CAS-free
 * command acknowledgements. Both start at 1 with the first event.
 */
export class SessionRuntimeStore {
  private readonly runtimes = new Map<string, SessionRuntime>();

  ensure(sessionId: string): SessionRuntime {
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      return existing;
    }
    const created: SessionRuntime = {
      state: createTranslationState(sessionId),
      events: [],
      listeners: new Set(),
    };
    this.runtimes.set(sessionId, created);
    return created;
  }

  has(sessionId: string): boolean {
    return this.runtimes.has(sessionId);
  }

  cursor(sessionId: string): SessionRuntimeCursor {
    const runtime = this.runtimes.get(sessionId);
    return {
      eventSeq: runtime?.state.seq ?? 0,
      stateRevision: runtime?.state.stateRevision ?? 0,
    };
  }

  eventsAfter(sessionId: string, afterSeq: number): ZCodeSessionEvent[] {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      return [];
    }
    return runtime.events.filter((event) => event.seq > afterSeq);
  }

  /** The timestamp of the retained event with this exact seq, when present. */
  eventTimestampAt(sessionId: string, seq: number): number | null {
    const runtime = this.runtimes.get(sessionId);
    const event = runtime?.events.find((item) => item.seq === seq);
    return event ? event.timestamp : null;
  }

  /**
   * True only between `turn.started` and the terminal turn event. A runtime
   * that has not begun a turn is idle, not running: `turnTerminal` starts
   * false, so it cannot be used on its own.
   */
  isTurnActive(sessionId: string): boolean {
    const state = this.runtimes.get(sessionId)?.state;
    return state ? state.turnStartedAt > 0 && !state.turnTerminal : false;
  }

  hasTerminal(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.state.turnTerminal ?? true;
  }

  applyAgentEvent(event: AgentEvent): ZCodeSessionEvent[] {
    const runtime = this.ensure(event.sessionId);
    const translated = translateAgentEvent(event, runtime.state);
    for (const item of translated) {
      this.record(runtime, item);
    }
    return translated;
  }

  append(
    sessionId: string,
    type: ZCodeSessionEventType,
    payload: unknown,
    timestamp: number = Date.now(),
    turnId?: string | null,
  ): ZCodeSessionEvent {
    const runtime = this.ensure(sessionId);
    const event = stamp(runtime.state, type, payload, timestamp, turnId);
    this.record(runtime, event);
    return event;
  }

  bumpRevision(sessionId: string): number {
    const runtime = this.ensure(sessionId);
    runtime.state.stateRevision += 1;
    return runtime.state.stateRevision;
  }

  subscribe(
    sessionId: string,
    listener: (event: ZCodeSessionEvent) => void,
  ): () => void {
    const runtime = this.ensure(sessionId);
    runtime.listeners.add(listener);
    return () => {
      runtime.listeners.delete(listener);
    };
  }

  private record(runtime: SessionRuntime, event: ZCodeSessionEvent): void {
    runtime.events.push(event);
    if (runtime.events.length > MAX_RETAINED_EVENTS) {
      runtime.events.splice(0, runtime.events.length - MAX_RETAINED_EVENTS);
    }
    for (const listener of runtime.listeners) {
      listener(event);
    }
  }
}
