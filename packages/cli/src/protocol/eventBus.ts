import type { AgentEvent } from "./events.js";

/**
 * Process-wide fan-out for surfaces that are not the caller of the run, such as
 * the SSE endpoint. The controller always delivers to its own subscriber; this
 * bus is the optional second consumer.
 */
type Listener = (event: AgentEvent) => void;

const listeners = new Set<Listener>();

export function publishAgentEvent(event: AgentEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeAgentEvents(
  listener: Listener,
  sessionId?: string,
): () => void {
  const scoped: Listener = (event) => {
    if (sessionId === undefined || event.sessionId === sessionId) {
      listener(event);
    }
  };
  listeners.add(scoped);
  return () => {
    listeners.delete(scoped);
  };
}

export function resetAgentEventBus(): void {
  listeners.clear();
}
