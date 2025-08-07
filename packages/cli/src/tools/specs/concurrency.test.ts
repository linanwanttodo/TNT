import { describe, expect, it } from "vitest";

import { claimForToolCall, normalizePathKey } from "./concurrency.js";

describe("claimForToolCall", () => {
  it("treats read-only tools as unserialized", () => {
    for (const name of ["Read", "Search", "Grep", "List", "Fetch", "Diff"]) {
      expect(claimForToolCall(name, {})).toEqual({
        exclusive: false,
        keys: [],
      });
    }
  });

  it("resolves a write to its own path shard", () => {
    expect(claimForToolCall("Edit", { path: "src/a.ts" })).toEqual({
      exclusive: false,
      keys: ["src/a.ts"],
    });
  });

  it("resolves the argument name each writing tool actually uses", () => {
    // Write takes `filepath`; Edit and MultiEdit take `file_path`. Reading a
    // single spelling would resolve no key and serialize every write.
    const calls: Array<[string, Record<string, unknown>]> = [
      ["Write", { filepath: "src/a.ts", content: "x" }],
      ["Edit", { file_path: "src/a.ts" }],
      ["MultiEdit", { file_path: "src/a.ts", edits: [] }],
    ];
    for (const [name, args] of calls) {
      expect(claimForToolCall(name, args)).toEqual({
        exclusive: false,
        keys: ["src/a.ts"],
      });
    }
  });

  it("puts every spelling of the same path on one shard", () => {
    const shards = [
      claimForToolCall("Write", { path: "src/a.ts" }).keys,
      claimForToolCall("Write", { filepath: "src/a.ts" }).keys,
      claimForToolCall("Edit", { file_path: "src/a.ts" }).keys,
      claimForToolCall("Edit", { filePath: "./src/a.ts" }).keys,
    ];
    for (const shard of shards) {
      expect(shard).toEqual(["src/a.ts"]);
    }
  });

  it("gives two spellings of the same path the same shard", () => {
    expect(claimForToolCall("Write", { path: "./src/a.ts" }).keys).toEqual(
      claimForToolCall("Edit", { path: "src/a.ts" }).keys,
    );
  });

  it("keeps absolute paths distinct from relative ones", () => {
    expect(normalizePathKey("/src/a.ts")).not.toBe(
      normalizePathKey("src/a.ts"),
    );
  });

  it("falls back to the global slot when a write names no path", () => {
    expect(claimForToolCall("Write", {})).toEqual({
      exclusive: true,
      keys: [],
    });
  });

  it("keeps a read-only shell command unserialized", () => {
    expect(claimForToolCall("Bash", { command: "ls -la" })).toEqual({
      exclusive: false,
      keys: ["shell:read"],
    });
  });

  it("serializes a shell command that mutates state", () => {
    for (const command of [
      "rm -rf build",
      "git commit -m x",
      "npm install",
      "mv a b",
      "cat x | jq . > out.json",
      "mkdir -p a && echo done",
    ]) {
      expect(claimForToolCall("Bash", { command })).toEqual({
        exclusive: true,
        keys: [],
      });
    }
  });

  it("treats unknown tools, including MCP tools, as exclusive", () => {
    expect(claimForToolCall("some_mcp_tool", {})).toEqual({
      exclusive: true,
      keys: [],
    });
  });

  it("treats delegation and flow tools as exclusive", () => {
    for (const name of ["Subagent", "Checklist", "Exit", "AskQuestion"]) {
      expect(claimForToolCall(name, {}).exclusive).toBe(true);
    }
  });
});
