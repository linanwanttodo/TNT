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
  it("folds a run of three finished calls of the same tool", () => {
    const clusters = clusterToolStates([
      state("read_file", "done", "1"),
      state("read_file", "done", "2"),
      state("read_file", "done", "3"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].collapsed).toBe(true);
    expect(clusterSummary(clusters[0], "Read")).toEqual({
      label: "Read · 3 calls",
      hidden: 2,
    });
  });

  it("keeps short runs, different tools and live calls visible", () => {
    const clusters = clusterToolStates([
      state("read_file", "done", "1"),
      state("read_file", "done", "2"),
      state("bash", "calling", "3"),
      state("bash", "done", "4"),
    ]);
    expect(clusters.every((cluster) => !cluster.collapsed)).toBe(true);
    expect(clusters).toHaveLength(3);
  });

  it("never folds a failed call into its neighbours", () => {
    const clusters = clusterToolStates([
      state("bash", "done", "1"),
      state("bash", "done", "2"),
      state("bash", "errored", "3"),
      state("bash", "done", "4"),
    ]);
    expect(clusters.every((cluster) => !cluster.collapsed)).toBe(true);
    expect(clusters[clusters.length - 1].states[0].status).toBe("done");
  });
});
