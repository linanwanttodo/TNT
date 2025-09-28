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

describe("one handler failing next to another", () => {
  it("keeps the block raised by the handler that still worked", async () => {
    const result = await runHooks(
      commands("exit 1", "echo 'no deploy on this branch' 1>&2; exit 2"),
      toolCall(),
      workDir,
    );

    expect(result.results).toHaveLength(2);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("no deploy on this branch");
  });

  it("keeps the decision the handler that crashed never made", async () => {
    const result = await runHooks(
      commands(
        "definitely-not-a-real-binary-xyz --flag",
        `printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"ls -la"}}}'`,
      ),
      toolCall(),
      workDir,
    );

    expect(result.results).toHaveLength(2);
    expect(result.blocked).toBe(false);
    expect(result.permissionDecision).toBe("allow");
    expect(result.updatedInput).toEqual({ command: "ls -la" });
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("command hook limits", () => {
  it("fails a hook that outlives its timeout and kills its children", async () => {
    const pidFile = path.join(workDir, "timed-out-hook.pid");
    const config: HooksConfig = {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `sh -c 'sleep 30 & echo $! > ${pidFile}; wait'`,
              timeout: 1,
            },
          ],
        },
      ],
    };

    const result = await runHooks(config, toolCall(), workDir);

    // A killed hook must not read as a success: it is a failure, and it says
    // why.
    expect(result.results[0].exitCode).toBe(1);
    expect(result.results[0].stderr).toContain("timed out");

    // The work the hook started dies with it, not thirty seconds later.
    expect(fs.existsSync(pidFile)).toBe(true);
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
    expect(isAlive(pid)).toBe(false);
  }, 30_000);

  it("fails a hook whose output runs away", async () => {
    const config: HooksConfig = {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "head -c 11000000 /dev/zero | tr '\\0' x",
              timeout: 30,
            },
          ],
        },
      ],
    };

    const result = await runHooks(config, toolCall(), workDir);

    expect(result.results[0].exitCode).toBe(1);
    expect(result.results[0].stderr).toContain("size limit");
    expect(result.blocked).toBe(false);
  }, 30_000);
});

/**
 * `once` is in the reference schema for every handler type and was declared here
 * with a comment claiming it was for skills, which is not what it says there: the
 * handler runs one time and is then spent.
 */
describe("once handlers", () => {
  function countingConfig(counter: string, once: boolean): HooksConfig {
    const handler: HookHandler = {
      type: "command",
      command: `n=$(cat "${counter}" 2>/dev/null || echo 0); echo $((n+1)) > "${counter}"`,
      ...(once ? { once: true } : {}),
    };
    return { PreToolUse: [{ matcher: "*", hooks: [handler] }] };
  }

  async function readCounter(counter: string): Promise<number> {
    const raw = await fs.promises.readFile(counter, "utf-8");
    return Number(raw.trim());
  }

  it("runs the first event and nothing after it", async () => {
    const counter = path.join(workDir, "once-count");
    await fs.promises.rm(counter, { force: true });
    const onceKeys = new Set<string>();
    const config = countingConfig(counter, true);

    await runHooks(config, toolCall(), workDir, onceKeys);
    await runHooks(config, toolCall(), workDir, onceKeys);
    await runHooks(config, toolCall(), workDir, onceKeys);

    expect(await readCounter(counter)).toBe(1);
    expect(onceKeys.size).toBe(1);
  }, 30_000);

  it("runs every time without the flag", async () => {
    const counter = path.join(workDir, "always-count");
    await fs.promises.rm(counter, { force: true });
    const onceKeys = new Set<string>();
    const config = countingConfig(counter, false);

    await runHooks(config, toolCall(), workDir, onceKeys);
    await runHooks(config, toolCall(), workDir, onceKeys);

    expect(await readCounter(counter)).toBe(2);
    expect(onceKeys.size).toBe(0);
  }, 30_000);

  it("spends the handler even when no set is handed to it", async () => {
    // A caller that tracks nothing must not turn the flag into a no-op: the
    // handler still runs, which is the behaviour the field promised before.
    const counter = path.join(workDir, "no-set-count");
    await fs.promises.rm(counter, { force: true });
    const config = countingConfig(counter, true);

    await runHooks(config, toolCall(), workDir);

    expect(await readCounter(counter)).toBe(1);
  }, 30_000);
});
