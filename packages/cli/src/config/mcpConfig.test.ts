import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadMcpJsonServers, mcpJsonPaths } from "./mcpConfig.js";
import { trustProject } from "./trust.js";

describe("mcp.json", () => {
  const previousHome = process.env.TNT_GLOBAL_DIR;
  let project: string;

  beforeEach(() => {
    process.env.TNT_GLOBAL_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-mcp-home-"),
    );
    project = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-mcp-project-"));
    fs.mkdirSync(path.join(project, ".tnt"));
  });

  afterAll(() => {
    if (previousHome === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousHome;
    }
  });

  const write = (file: string, servers: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }), "utf-8");
  };

  it("reads the user file", () => {
    write(path.join(process.env.TNT_GLOBAL_DIR!, "mcp.json"), {
      github: { command: "npx", args: ["github-server"] },
    });

    expect(loadMcpJsonServers(project)).toEqual([
      { name: "github", command: "npx", args: ["github-server"] },
    ]);
  });

  it("merges project servers by name after the user file", () => {
    write(path.join(process.env.TNT_GLOBAL_DIR!, "mcp.json"), {
      github: { command: "user-github" },
      shared: { command: "user-shared" },
    });
    write(path.join(project, ".tnt", "mcp.json"), {
      shared: { command: "project-shared" },
      local: { command: "project-local" },
    });
    trustProject(project);

    expect(loadMcpJsonServers(project)).toEqual([
      { name: "github", command: "user-github" },
      { name: "shared", command: "project-shared" },
      { name: "local", command: "project-local" },
    ]);
  });

  it("ignores project files until they are trusted", () => {
    write(path.join(project, ".tnt", "mcp.json"), {
      local: { command: "project-local" },
    });

    expect(mcpJsonPaths(project)).toEqual([
      path.join(process.env.TNT_GLOBAL_DIR!, "mcp.json"),
    ]);
    expect(loadMcpJsonServers(project)).toEqual([]);
  });

  it("reads the Claude-compatible root .mcp.json when trusted", () => {
    write(path.join(project, ".mcp.json"), {
      compat: { command: "compat-server" },
    });
    trustProject(project);

    expect(loadMcpJsonServers(project).map((server) => server.name)).toEqual([
      "compat",
    ]);
  });

  it("ignores malformed files and entries without taking the others down", () => {
    fs.writeFileSync(
      path.join(process.env.TNT_GLOBAL_DIR!, "mcp.json"),
      "{not json",
      "utf-8",
    );
    write(path.join(project, ".tnt", "mcp.json"), {
      good: { command: "ok" },
      bad: "not-an-object",
    });
    trustProject(project);

    expect(loadMcpJsonServers(project)).toEqual([
      { name: "good", command: "ok" },
    ]);
  });
});
