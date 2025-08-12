import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, describe, expect, it } from "vitest";

import { runHooks } from "./hookRunner.js";
import type { HookHandler, HooksConfig, PreToolUseInput } from "./types.js";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hooks-"));

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function toolCall(toolName = "Bash"): PreToolUseInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    transcript_path: path.join(workDir, "transcript.jsonl"),
    cwd: workDir,
    tool_name: toolName,
    tool_input: { command: "ls" },
    tool_use_id: "tool-1",
  };
}

function commands(...command: string[]): HooksConfig {
  const handlers: HookHandler[] = command.map((cmd) => ({
    type: "command",
    command: cmd,
  }));
  return { PreToolUse: [{ matcher: "*", hooks: handlers }] };
}

describe("command hook exit codes", () => {
  it("proceeds on exit 0 and parses JSON output", async () => {
    const result = await runHooks(
      commands(`printf '{"systemMessage":"hello"}'`),
      toolCall(),
      workDir,
    );

    expect(result.blocked).toBe(false);
    expect(result.results[0].exitCode).toBe(0);
    expect(result.results[0].output).toEqual({ systemMessage: "hello" });
  });

  it("blocks on exit 2 and uses stderr as the reason", async () => {
    const result = await runHooks(
      commands("echo 'not allowed on this branch' 1>&2; exit 2"),
      toolCall(),
      workDir,
    );

    expect(result.blocked).toBe(true);
    expect(result.results[0].blocked).toBe(true);
    expect(result.results[0].blockReason).toBe("not allowed on this branch");
  });

  it("blocks on a JSON decision even with exit 0", async () => {
    const result = await runHooks(
      commands(`printf '{"decision":"block","reason":"policy"}'`),
      toolCall(),
      workDir,
    );

    expect(result.blocked).toBe(true);
    expect(result.results[0].blockReason).toBe("policy");
  });

  it("treats any other exit code as a non-blocking error", async () => {
    const result = await runHooks(
      commands("echo 'boom' 1>&2; exit 1"),
      toolCall(),
      workDir,
    );

    expect(result.blocked).toBe(false);
    expect(result.results[0].exitCode).toBe(1);
    expect(result.results[0].stderr).toBe("boom");
    expect(result.results[0].blocked).toBe(false);
  });

  it("does not throw when the command does not exist", async () => {
    const result = await runHooks(
      commands("definitely-not-a-real-binary-xyz --flag"),
      toolCall(),
      workDir,
    );

    expect(result.blocked).toBe(false);
    expect(result.results[0].exitCode).not.toBe(0);
  });

  it("keeps raw stdout when it is not JSON", async () => {
    const result = await runHooks(
      commands("echo plain-text"),
      toolCall(),
      workDir,
    );

    expect(result.results[0].output).toBeNull();
    expect(result.results[0].stdout).toBe("plain-text");
  });
});

describe("command hook environment", () => {
  it("receives the hook payload on stdin", async () => {
    const result = await runHooks(commands(`cat`), toolCall("Read"), workDir);

    const echoed = JSON.parse(result.results[0].stdout) as {
      hook_event_name: string;
      tool_name: string;
    };
    expect(echoed.hook_event_name).toBe("PreToolUse");
    expect(echoed.tool_name).toBe("Read");
  });

  it("exposes the project directory to the command", async () => {
    const result = await runHooks(
      commands(`printf '{"dir":"%s"}' "$CLAUDE_PROJECT_DIR"`),
      toolCall(),
      workDir,
    );

    expect(result.results[0].output).toEqual({ dir: workDir });
  });
});

describe("hook matching", () => {
  const config: HooksConfig = {
    PreToolUse: [
      {
        matcher: "^Bash$",
        hooks: [{ type: "command", command: `printf '{"ran":true}'` }],
      },
    ],
  };

  it("runs the handler when the matcher accepts the tool", async () => {
    const result = await runHooks(config, toolCall("Bash"), workDir);

    expect(result.results).toHaveLength(1);
  });

  it("skips the handler when the matcher rejects the tool", async () => {
    const result = await runHooks(config, toolCall("Read"), workDir);

    expect(result.results).toHaveLength(0);
    expect(result.blocked).toBe(false);
  });

  it("runs the same command once when two groups declare it", async () => {
    const duplicated: HooksConfig = {
      PreToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: "echo dup" }] },
        {
          matcher: "^Bash$",
          hooks: [{ type: "command", command: "echo dup" }],
        },
      ],
    };

    const result = await runHooks(duplicated, toolCall("Bash"), workDir);

    expect(result.results).toHaveLength(1);
  });

  it("returns nothing to do when no event matches", async () => {
    const result = await runHooks(
      { SessionStart: [{ hooks: [{ type: "command", command: "echo x" }] }] },
      toolCall(),
      workDir,
    );

    expect(result).toEqual({ blocked: false, results: [] });
  });
});
