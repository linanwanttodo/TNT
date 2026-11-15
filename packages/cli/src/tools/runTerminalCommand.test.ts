import { textRun } from "../../test-utils/toolText.js";

import {
  isRunningInWsl,
  runTerminalCommandTool,
} from "./runTerminalCommand.js";

const runText = textRun(runTerminalCommandTool);

describe("runTerminalCommandTool", () => {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  describe("basic platform-specific terminal execution", () => {
    it("should execute a simple echo command", async () => {
      let command: string;
      let expectedOutput: string;

      if (isWindows) {
        command = 'Write-Output "hello world"';
        expectedOutput = "hello world";
      } else {
        command = 'echo "hello world"';
        expectedOutput = "hello world";
      }

      const result = await runText({ command });
      expect(result.trim()).toBe(expectedOutput);
    });

    it("should get current directory", async () => {
      let command: string;

      if (isWindows) {
        command = "Get-Location | Select-Object -ExpandProperty Path";
      } else {
        command = "pwd";
      }

      const result = await runText({ command });

      if (isWindows) {
        // Windows paths like C:\path\to\dir
        expect(result.trim()).toMatch(/^[A-Za-z]:\\.*/);
      } else {
        // Unix paths like /path/to/dir
        expect(result.trim()).toMatch(/^\/.*$/);
      }
    });

    it("should list directory contents", async () => {
      let command: string;

      if (isWindows) {
        command = "Get-ChildItem | Select-Object -ExpandProperty Name";
      } else {
        command = "ls";
      }

      const result = await runText({ command });
      // Should return some directory content (not empty)
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle command that produces version info", async () => {
      // Node.js should be available on all platforms in CI
      const command = "node --version";
      const result = await runText({ command });

      // Should contain version number (starts with v)
      expect(result.trim()).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });

  describe("basic error handling", () => {
    it("should handle non-existent commands", async () => {
      const command = "definitely-not-a-real-command-xyz123";

      await expect(runText({ command })).rejects.toMatch(
        /Error \(exit code|Command timed out|not found|not recognized/,
      );
    });
  });

  describe("platform-specific features", () => {
    if (isWindows) {
      it("should work with Windows commands", async () => {
        const result = await runText({
          command: "Write-Output $env:OS",
        });
        expect(result.trim()).toBe("Windows_NT");
      });
    }

    if (isMac) {
      it("should work with macOS commands", async () => {
        const result = await runText({
          command: "uname -s",
        });
        expect(result.trim()).toBe("Darwin");
      });
    }

    if (isLinux) {
      it("should work with Linux commands", async () => {
        const result = await runText({
          command: "uname -s",
        });
        expect(result.trim()).toBe("Linux");
      });
    }
  });

  // Windows has no process groups, no `trap`, and a shell that reads neither
  // `$!` nor `SHELL`; the semantics under test are the POSIX ones.
  describe.skipIf(isWindows)("process control", () => {
    // Windows has no process groups and PowerShell has no `trap`; the
    // semantics under test are the POSIX ones.
    const runWithAbort = async (
      command: string,
      abortAfterMs: number,
    ): Promise<string> => {
      const controller = new AbortController();
      const pending = runTerminalCommandTool.run!(
        { command },
        {
          toolCallId: "call-pc",
          parallelToolCallCount: 1,
          signal: controller.signal,
        },
      );
      setTimeout(() => controller.abort(), abortAfterMs);
      return String(await pending);
    };

    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const waitForExit = async (pid: number, limitMs: number): Promise<void> => {
      const until = Date.now() + limitMs;
      while (isAlive(pid) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    const pidFrom = (text: string): number => {
      const match = text.match(/\d+/);
      return match ? Number(match[0]) : -1;
    };

    it("keeps a multibyte character split across two output chunks", async () => {
      // 中 is E4 B8 AD, i.e. \344 \270 \255. The two writes are separated in
      // time, so the stream delivers a lone lead byte and then the tail;
      // decoding each chunk on its own turns both into replacements.
      const result = await runWithAbort(
        "printf '\\344'; sleep 0.3; printf '\\270\\255'",
        60_000,
      );
      expect(result).toContain("中");
      expect(result).not.toContain("\uFFFD");
    }, 30_000);

    it("stops the processes the shell started, not only the shell", async () => {
      const result = await runWithAbort("sleep 30 & echo $!; wait", 400);
      const pid = pidFrom(result);
      expect(pid).toBeGreaterThan(0);
      await waitForExit(pid, 3_000);
      expect(isAlive(pid)).toBe(false);
    }, 30_000);

    it("escalates to SIGKILL when the command ignores SIGTERM", async () => {
      // A shell that traps TERM keeps going after the group's first sleep is
      // killed, so only the escalation can end it.
      const result = await runWithAbort(
        "trap '' TERM; echo $$; sleep 20; sleep 20; sleep 20",
        400,
      );
      const pid = pidFrom(result);
      expect(pid).toBeGreaterThan(0);
      // The escalation window is 5s; eight seconds allows for scheduling.
      await waitForExit(pid, 8_000);
      expect(isAlive(pid)).toBe(false);
    }, 30_000);

    it("cancels the escalation once the stopped command has exited", async () => {
      const signals: string[] = [];
      const realKill = process.kill;
      process.kill = ((target: number, signal?: string) => {
        signals.push(String(signal));
        return realKill.call(process, target as never, signal as never);
      }) as typeof process.kill;

      try {
        // A plain sleep dies on TERM, so the group is gone long before the
        // escalation would be worth sending.
        await runWithAbort("sleep 30", 400);
        // Past the five-second window: an armed timer would fire here and
        // signal a group id the shell has already released for reuse.
        await new Promise((r) => setTimeout(r, 6_000));
      } finally {
        process.kill = realKill;
      }

      expect(signals).toContain("SIGTERM");
      expect(signals.filter((s) => s === "SIGKILL")).toEqual([]);
    }, 30_000);

    it("reports a command whose shell could not be spawned", async () => {
      const previous = process.env.SHELL;
      process.env.SHELL = "/nonexistent/tnt-test-shell";
      try {
        const started = Date.now();
        await expect(
          runTerminalCommandTool.run!(
            { command: "echo hi" },
            { toolCallId: "call-spawn", parallelToolCallCount: 1 },
          ),
        ).rejects.toThrow(/tnt-test-shell/);
        // Without the error handler nothing settles and the call sits until
        // the idle timeout.
        expect(Date.now() - started).toBeLessThan(15_000);
      } finally {
        if (previous === undefined) delete process.env.SHELL;
        else process.env.SHELL = previous;
      }
    }, 30_000);
  });

  describe("run deadline", () => {
    const sleepCommand = isWindows ? "Start-Sleep -Seconds 30" : "sleep 30";

    it("stops a running command when the run is aborted", async () => {
      const controller = new AbortController();
      const started = Date.now();
      const pending = runTerminalCommandTool.run!(
        { command: sleepCommand },
        {
          toolCallId: "call-1",
          parallelToolCallCount: 1,
          signal: controller.signal,
        },
      );
      setTimeout(() => controller.abort(), 200);

      const result = String(await pending);

      // The command would run for 30 seconds; stopping on the abort is the only
      // way this returns in the deadline's neighbourhood instead.
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(result).toContain("the run reached its time limit");
    });

    it("does not start the command when the run was already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const started = Date.now();

      const result = String(
        await runTerminalCommandTool.run!(
          { command: sleepCommand },
          {
            toolCallId: "call-2",
            parallelToolCallCount: 1,
            signal: controller.signal,
          },
        ),
      );

      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result).toContain("the run reached its time limit");
    });
  });

  describe("WSL detection", () => {
    it("should cache the WSL detection result", () => {
      const firstResult = isRunningInWsl();
      const secondResult = isRunningInWsl();
      expect(firstResult).toBe(secondResult);
    });

    if (!isLinux) {
      it("should return false on non-Linux platforms", () => {
        expect(isRunningInWsl()).toBe(false);
      });
    }
  });
});
