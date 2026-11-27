import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetAgentEventBus,
  subscribeAgentEvents,
} from "../../protocol/eventBus.js";
import type { AgentEvent } from "../../protocol/events.js";

import { requestParentInput } from "./pingHandler.js";
import { clearSubagentRuns, createSubagentRun } from "./spawner.js";

const agent = { model: { name: "explore" }, llmApi: {}, assistant: {} } as any;
let events: AgentEvent[];

beforeEach(() => {
  clearSubagentRuns();
  events = [];
  subscribeAgentEvents((event) => events.push(event));
});

afterEach(() => {
  resetAgentEventBus();
});

describe("parent input requests", () => {
  it("pauses the child and publishes its session and question", () => {
    const run = createSubagentRun({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      realmId: 1,
      agent,
    });

    requestParentInput(run, "Which migration should I keep?");

    expect(run.status).toBe("waiting_input");
    expect(run.abortController.signal.aborted).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({
        type: "subagent.ping",
        sessionId: "parent-1",
        childSessionId: "child-1",
        content: "Which migration should I keep?",
      }),
    ]);
  });
});
