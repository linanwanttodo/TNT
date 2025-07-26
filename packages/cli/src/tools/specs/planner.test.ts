import { describe, expect, it } from "vitest";

import { planToolCalls } from "./planner.js";

function call(name: string, args: any = {}) {
  return { id: `${name}-${JSON.stringify(args)}`, name, arguments: args };
}

describe("planToolCalls", () => {
  it("groups unserialized calls into one concurrent step", () => {
    const plan = planToolCalls([call("Read", { path: "a" }), call("Search")]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].barrier).toBe(false);
    expect(plan.steps[0].calls).toHaveLength(2);
  });

  it("reports the step size as the parallel count", () => {
    const plan = planToolCalls([
      call("Read", { path: "a" }),
      call("Read", { path: "b" }),
    ]);
    expect(plan.steps[0].calls.map((c) => c.parallelCount)).toEqual([2, 2]);
  });

  it("reports a parallel count of one for a serialized call", () => {
    const plan = planToolCalls([call("Write", { path: "a.ts" })]);
    expect(plan.steps[0].calls[0].parallelCount).toBe(1);
  });

  it("splits reads into waves at the read cap", () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      call("Read", { path: `f${i}.ts` }),
    );
    const plan = planToolCalls(calls);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].calls).toHaveLength(8);
    expect(plan.steps[1].calls).toHaveLength(2);
  });

  it("keeps original order in the flat view", () => {
    const plan = planToolCalls([
      call("Write", { path: "a.ts" }),
      call("Read", { path: "b.ts" }),
      call("Edit", { path: "a.ts" }),
    ]);
    expect(plan.all.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("marks a step holding a slot as a barrier", () => {
    const plan = planToolCalls([call("Subagent")]);
    expect(plan.steps[0].barrier).toBe(true);
  });

  it("gives two edits to the same path the same shard key", () => {
    const plan = planToolCalls([
      call("Write", { path: "src/a.ts" }),
      call("Edit", { path: "./src/a.ts" }),
    ]);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].calls[0].keys).toEqual(plan.steps[1].calls[0].keys);
  });

  it("handles an empty batch", () => {
    expect(planToolCalls([]).steps).toEqual([]);
  });
});
