import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importGraphDeps, importGraphTool } from "./importGraph.js";

const fake = {
  refresh: vi.fn(async () => ({ files: 3, parsed: 3 })),
  dependencies: vi.fn(async () => [
    { path: "src/b.ts", depth: 1, via: "./b" },
    { path: "src/c.ts", depth: 2, via: "./b" },
  ]),
  dependents: vi.fn(async () => [
    { path: "src/caller.ts", depth: 1, via: "./a" },
  ]),
  unresolved: vi.fn(async () => ["react"]),
};

const previous = importGraphDeps.service;

beforeEach(() => {
  vi.clearAllMocks();
  importGraphDeps.service = () => fake as any;
});

afterEach(() => {
  importGraphDeps.service = previous;
});

describe("the import graph tool", () => {
  it("is read-only and needs an action and file", () => {
    expect(importGraphTool.readonly).toBe(true);
    expect(importGraphTool.isBuiltIn).toBe(true);
    expect(importGraphTool.parameters.required).toEqual([
      "action",
      "file_path",
    ]);
  });

  it("rejects an unknown action", async () => {
    expect(
      await importGraphTool.run({ action: "impact", file_path: "src/a.ts" }),
    ).toContain('"dependencies" or "dependents"');
  });

  it("rejects a depth outside the supported range", async () => {
    expect(
      await importGraphTool.run({
        action: "dependencies",
        file_path: "src/a.ts",
        depth: 9,
      }),
    ).toContain("between 1 and 5");
  });

  it("lists resolved dependencies and external specifiers", async () => {
    const result = await importGraphTool.run({
      action: "dependencies",
      file_path: "src/a.ts",
    });

    expect(fake.refresh).toHaveBeenCalled();
    expect(result).toContain("2 dependencies of src/a.ts:");
    expect(result).toContain("src/b.ts (via ./b)");
    expect(result).toContain("src/c.ts (depth 2, via ./b)");
    expect(result).toContain("External: react");
  });

  it("lists dependents", async () => {
    const result = await importGraphTool.run({
      action: "dependents",
      file_path: "src/a.ts",
      depth: 2,
    });

    expect(fake.dependents).toHaveBeenCalledWith("src/a.ts", 2);
    expect(result).toContain("1 dependent of src/a.ts:");
    expect(result).toContain("src/caller.ts (via ./a)");
    expect(result).not.toContain("External:");
  });

  it("says when nothing is recorded", async () => {
    fake.dependencies.mockResolvedValueOnce([]);
    fake.unresolved.mockResolvedValueOnce([]);

    const result = await importGraphTool.run({
      action: "dependencies",
      file_path: "src/lonely.ts",
    });

    expect(result).toContain("No dependencies recorded");
  });
});
