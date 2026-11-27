import { beforeEach, describe, expect, it } from "vitest";

import { queueSubagentMessage, takePendingMessages } from "./resumer.js";
import { clearSubagentRuns, createSubagentRun } from "./spawner.js";

const agent = { model: { name: "explore" }, llmApi: {}, assistant: {} } as any;

beforeEach(() => {
  clearSubagentRuns();
});

describe("subagent message queue", () => {
  it("keeps steers ordered and drains them once", () => {
    const run = createSubagentRun({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      realmId: 1,
      agent,
    });
    queueSubagentMessage(run, "first");
    queueSubagentMessage(run, "second");
    queueSubagentMessage(run, "  ");

    expect(takePendingMessages(run)).toEqual(["first", "second"]);
    expect(takePendingMessages(run)).toEqual([]);
  });
});
