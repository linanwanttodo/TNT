import { beforeEach, describe, expect, it } from "vitest";

import {
  publishAgentEvent,
  resetAgentEventBus,
  subscribeAgentEvents,
} from "./eventBus.js";
import type { AgentEvent } from "./events.js";

function notice(sessionId: string, message: string): AgentEvent {
  return {
    type: "notice",
    sessionId,
    turnId: "turn-1",
    seq: 1,
    timestamp: 1,
    message,
  };
}

beforeEach(() => resetAgentEventBus());

describe("session-scoped agent events", () => {
  it("does not deliver another session's events to a scoped listener", () => {
    const received: AgentEvent[] = [];
    subscribeAgentEvents((event) => received.push(event), "session-a");

    publishAgentEvent(notice("session-a", "own"));
    publishAgentEvent(notice("session-b", "foreign"));

    expect(received).toEqual([notice("session-a", "own")]);
  });

  it("keeps the unscoped bus available to process-wide observers", () => {
    const received: AgentEvent[] = [];
    subscribeAgentEvents((event) => received.push(event));

    publishAgentEvent(notice("session-a", "one"));
    publishAgentEvent(notice("session-b", "two"));

    expect(received).toHaveLength(2);
  });
});
