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
