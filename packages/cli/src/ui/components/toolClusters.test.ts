import { describe, expect, it } from "vitest";

import { clusterSummary, clusterToolStates } from "./toolClusters.js";

function state(toolName: string, status: string, id: string) {
  return {
    toolCallId: id,
    status,
    toolCall: { function: { name: toolName, arguments: "{}" } },
    parsedArgs: {},
    output: [],
  } as unknown as import("../../../../../core/index.js").ToolCallState;
}

describe("tool display clusters", () => {
  it("folds consecutive finished calls even when the tools differ", () => {
    const clusters = clusterToolStates([
      state("read_file", "done", "1"),
      state("bash", "done", "2"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].collapsed).toBe(true);
    expect(clusterSummary(clusters[0])).toEqual({
      label: "2 calls",
      hidden: 1,
    });
  });

  it("keeps a live call outside the finished cluster", () => {
    const clusters = clusterToolStates([
      state("read_file", "done", "1"),
      state("bash", "calling", "2"),
      state("write_file", "done", "3"),
    ]);
    expect(clusters.every((cluster) => !cluster.collapsed)).toBe(true);
    expect(clusters).toHaveLength(3);
  });

  it("folds failures with their neighbours and reports the failure count", () => {
    const clusters = clusterToolStates([
      state("bash", "done", "1"),
      state("bash", "errored", "2"),
      state("read_file", "canceled", "3"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].collapsed).toBe(true);
    expect(clusterSummary(clusters[0])).toEqual({
      label: "3 calls · 1 failed",
      hidden: 2,
    });
  });

  it("does not hide a single finished call", () => {
    const clusters = clusterToolStates([state("read_file", "done", "1")]);
    expect(clusters[0].collapsed).toBe(false);
  });
});
