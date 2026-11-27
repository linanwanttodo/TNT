import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSubagentRuns,
  createSubagentRun,
  findSubagentRunBySessionId,
  getSubagentRun,
  listSubagentRuns,
  updateSubagentRun,
} from "./spawner.js";

const agent = { model: { name: "explore" }, llmApi: {}, assistant: {} } as any;

beforeEach(() => {
  clearSubagentRuns();
});

describe("subagent run registry", () => {
  it("creates a unique live handle for a persisted child session", () => {
    const run = createSubagentRun({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      realmId: 7,
      agent,
    });

    expect(run).toMatchObject({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      realmId: 7,
      agentType: "explore",
      status: "pending",
    });
    expect(getSubagentRun(run.runId)).toBe(run);
    expect(findSubagentRunBySessionId("child-1")).toBe(run);
  });

  it("lists only runs belonging to the requested parent", () => {
    createSubagentRun({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      realmId: 1,
      agent,
    });
    createSubagentRun({
      sessionId: "child-2",
      parentSessionId: "parent-2",
      realmId: 1,
      agent,
    });

    expect(listSubagentRuns("parent-1")).toHaveLength(1);
    expect(listSubagentRuns()).toHaveLength(2);
  });

  it("updates status without replacing the run identity", () => {
    const run = createSubagentRun({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      realmId: 1,
      agent,
    });
    updateSubagentRun(run.runId, { status: "waiting_input" });

    expect(getSubagentRun(run.runId)).toBe(run);
    expect(run.status).toBe("waiting_input");
  });
});
