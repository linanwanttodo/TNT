import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claudeTranscriptToHistory,
  importCandidates,
  scanImportCandidates,
} from "./importSources.js";

let root: string;
let claudeDir: string;
let tntDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-import-"));
  claudeDir = path.join(root, ".claude");
  tntDir = path.join(root, ".tnt");
  fs.mkdirSync(path.join(claudeDir, "projects", "demo"), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, "commands"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSession(id: string, lines: unknown[]): string {
  const file = path.join(claudeDir, "projects", "demo", `${id}.jsonl`);
  fs.writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  return file;
}

describe("external state import", () => {
  it("converts a Claude JSONL transcript into TNT history", () => {
    const file = writeSession("chat-1", [
      { type: "user", message: { content: "fix the bug" }, cwd: "/workspace" },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "done" }],
        },
      },
      { type: "tool_use", message: { content: "ignored" } },
    ]);

    const history = claudeTranscriptToHistory(file);
    expect(history.map((item) => item.message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(history[1].message.content).toBe("done");
  });

  it("scans sessions, MCP servers and skills from a Claude home", () => {
    writeSession("chat-2", [
      { type: "user", message: { content: "hello" }, cwd: "/workspace" },
    ]);
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ mcpServers: { filesystem: { command: "npx" } } }),
    );
    fs.writeFileSync(path.join(claudeDir, "skills", "review.md"), "review");
    fs.writeFileSync(path.join(claudeDir, "commands", "ship.md"), "ship");

    const candidates = scanImportCandidates({ claudeDir });
    expect(candidates.some((item) => item.sessionId === "chat-2")).toBe(true);
    expect(candidates.some((item) => item.sessionId === "mcp:filesystem")).toBe(
      true,
    );
    expect(candidates.some((item) => item.kind === "skill")).toBe(true);
    expect(candidates.some((item) => item.kind === "tool")).toBe(true);
  });

  it("ignores unsafe asset names and anchors writes inside the TNT dir", () => {
    fs.writeFileSync(path.join(claudeDir, "skills", "..escape"), "bad");
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ mcpServers: { "bad/../name": { command: "x" } } }),
    );

    const candidates = scanImportCandidates({ claudeDir });
    expect(candidates.some((item) => item.sessionId.includes(".."))).toBe(
      false,
    );

    fs.writeFileSync(path.join(claudeDir, "skills", "safe.md"), "safe");
    const result = importCandidates(["skills:safe.md"], {
      claudeDir,
      tntDir,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].path.startsWith(path.resolve(tntDir))).toBe(true);
    expect(fs.existsSync(path.join(tntDir, "skills", "safe.md"))).toBe(true);
  });

  it("is repeatable: a second import of the same asset overwrites in place", () => {
    fs.writeFileSync(path.join(claudeDir, "commands", "deploy.md"), "v1");
    const options = { claudeDir, tntDir };
    expect(
      importCandidates(["commands:deploy.md"], options).assets,
    ).toHaveLength(1);
    fs.writeFileSync(path.join(claudeDir, "commands", "deploy.md"), "v2");
    expect(
      importCandidates(["commands:deploy.md"], options).assets,
    ).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(tntDir, "commands", "deploy.md"), "utf8"),
    ).toBe("v2");
  });
});
