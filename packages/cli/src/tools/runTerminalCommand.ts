import { ChildProcess, spawn } from "child_process";
import fs from "fs";

import {
  evaluateTerminalCommandSecurity,
  type ToolPolicy,
} from "@tnt/terminal-security";

import { t } from "../i18n/index.js";
import { backgroundJobService } from "../services/BackgroundJobService.js";
import { services } from "../services/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import {
  isGitCommitCommand,
  isPullRequestCommand,
} from "../telemetry/utils.js";
import { backgroundSignalManager } from "../utils/backgroundSignalManager.js";
import { emitBashToolEnded, emitBashToolStarted } from "../utils/cli.js";
import {
  parseEnvNumber,
  truncateOutputFromStart,
} from "../utils/truncateOutput.js";

import { getTerminalRunner } from "./terminalRunner.js";
import { Tool, ToolRunContext } from "./types.js";

// Output truncation defaults
const DEFAULT_BASH_MAX_CHARS = 50000; // ~12.5k tokens
const DEFAULT_BASH_MAX_LINES = 1000;

/**
 * When running on Windows, but inside WSL, shell commands need to run using the WSL environment.
 */
export function isRunningInWsl(): boolean {
  // WSL only applies when platform reports as Linux
  if (process.platform !== "linux") {
    return false;
  }

  if (process.env.WSL_DISTRO_NAME) {
    return true;
  }

  // Check /proc/version for Microsoft/WSL indicators
  try {
    const procVersion = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return procVersion.includes("microsoft") || procVersion.includes("wsl");
  } catch {
    return false;
  }
}

function getBashMaxChars(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_BASH_MAX_OUTPUT_CHARS,
    DEFAULT_BASH_MAX_CHARS,
  );
}

function getBashMaxLines(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_BASH_MAX_OUTPUT_LINES,
    DEFAULT_BASH_MAX_LINES,
  );
}

function resolveBashTimeoutMs(timeout?: number): number {
  // The spec's shell-mode timeout: 180 seconds of no output by default,
  // capped at ten minutes when the call supplies one.
  let TIMEOUT_MS = 180000;
  if (timeout !== undefined) {
    const cappedTimeout = Math.min(timeout, 600);
    TIMEOUT_MS = cappedTimeout * 1000;
  } else if (
    process.env.NODE_ENV === "test" &&
    process.env.TEST_TERMINAL_TIMEOUT
  ) {
    TIMEOUT_MS = parseInt(process.env.TEST_TERMINAL_TIMEOUT, 10);
  }
  return TIMEOUT_MS;
}

function parallelLimitNote(
  output: string,
  parallelCount: number,
  baseMaxChars: number,
  baseMaxLines: number,
): string {
  if (parallelCount <= 1) return output;
  return (
    output +
    `\n\n(Note: output limit reduced due to ${parallelCount} parallel tool calls. ` +
    `Single-tool limit: ${baseMaxChars.toLocaleString()} characters or ${baseMaxLines.toLocaleString()} lines.)`
  );
}

// Helper function to use login shell on Unix/macOS and PowerShell on Windows and available shell in WSL
function getShellCommand(command: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    // Windows: Use PowerShell
    return {
      shell: "powershell.exe",
      args: ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", command],
    };
  }

  if (isRunningInWsl()) {
    // in WSL, bash is always available
    const wslShell = process.env.SHELL || "/bin/bash";
    return {
      shell: wslShell,
      args: ["-l", "-c", command],
    };
  }

  // Unix/macOS: Use login shell to source .bashrc/.zshrc etc.
  const userShell = process.env.SHELL || "/bin/bash";
  return { shell: userShell, args: ["-l", "-c", command] };
}

export function runCommandInBackground(command: string): {
  success: boolean;
  jobId?: string;
  error?: string;
} {
  const job = backgroundJobService.createJob(command);
  if (!job) {
    return {
      success: false,
      error: "Cannot create background job: limit of 5 concurrent jobs reached",
    };
  }

  const { shell, args } = getShellCommand(command);
  const child = backgroundJobService.startJob(job.id, shell, args);

  if (!child) {
    return {
      success: false,
      error: `Failed to start background job ${job.id}`,
    };
  }

  return {
    success: true,
    jobId: job.id,
  };
}

export const runTerminalCommandTool: Tool = {
  name: "Bash",
  displayName: "Bash",
  description: `Executes a terminal command and returns the output

Commands are automatically executed from the current working directory (${process.cwd()}), so there's no need to change directories with 'cd' commands.

USE THE DEDICATED TOOL WHEN ONE EXISTS - a shell pipeline loses the guard, the diff and the indexing that the tool gives you:
- Read a file with Read, not cat, head, tail or sed. A large file is read in sections with start_line/end_line, not with 'sed -n'.
- Change a file with Edit, MultiEdit or Write, not sed, awk or 'echo >'.
- Look for code with Search or CodebaseSearch, and list files with List, rather than grep, rg or find.
- Put text meant for the user in your reply, not in echo or printf.

HOW TO SHAPE A COMMAND:
- Prefer absolute paths and quote any path that can contain spaces. Avoid 'cd': the working directory is already the project, and a chain of commands shares one shell.
- Join commands that depend on each other with '&&', so a failure stops the chain. Use ';' only when the later commands may run regardless of it. Never separate commands with a newline.
- git: create a new commit rather than '--amend'. When a pre-commit hook fails, no commit happened, and amending would rewrite the previous one - fix the cause and commit again. Do not use 'git status -uall'; on a large tree it can exhaust memory. Commit, push or open a pull request only when the user asks for it.

WHAT COMES BACK:
- The output returns to you, not reliably to the user, so anything that matters has to be repeated in your answer.
- There is no terminal to answer a prompt: an interactive command ('git rebase -i', 'git add -i', an editor) waits forever. Pass flags that make it non-interactive, or leave it to the user.
`,
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description: "The command to execute in the terminal.",
      },
      timeout: {
        type: "number",
        description:
          "Optional timeout in seconds (max 600). Use this parameter for commands that take longer than the default 180 second timeout.",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    parsedArgs: Record<string, unknown>,
  ): ToolPolicy => {
    return evaluateTerminalCommandSecurity(
      basePolicy,
      parsedArgs.command as string,
    );
  },
  preprocess: async (args) => {
    const command = args.command;
    if (!command || typeof command !== "string") {
      throw new Error(t("tools.commandArgRequired"));
    }
    const truncatedCmd =
      command.length > 60 ? command.substring(0, 60) + "..." : command;
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will run: ${truncatedCmd}`,
        },
      ],
    };
  },
  run: async (
    {
      command,
      timeout,
    }: {
      command: string;
      timeout?: number;
    },
    context?: ToolRunContext,
  ): Promise<string> => {
    // Divide limits by parallel tool call count to avoid context overflow
    const parallelCount = context?.parallelToolCallCount ?? 1;
    const baseMaxChars = getBashMaxChars();
    const baseMaxLines = getBashMaxLines();
    const maxChars = Math.floor(baseMaxChars / parallelCount);
    const maxLines = Math.floor(baseMaxLines / parallelCount);

    const runner = getTerminalRunner();
    if (runner) {
      const { shell, args } = getShellCommand(command);
      const timeoutMs = resolveBashTimeoutMs(timeout);
      emitBashToolStarted();
      try {
        const result = await runner.run({
          shell,
          args,
          cwd: process.cwd(),
          timeoutMs,
        });
        const truncation = truncateOutputFromStart(result.output, {
          maxChars,
          maxLines,
        });
        let output = truncation.wasTruncated
          ? parallelLimitNote(
              truncation.output,
              parallelCount,
              baseMaxChars,
              baseMaxLines,
            )
          : truncation.output;
        if (result.backgroundJobId) {
          return `Command moved to background. Job ID: ${result.backgroundJobId}\nOutput so far:\n${output}\nUse CheckBackgroundJob("${result.backgroundJobId}") to check status. The editor terminal stays open, so answer any prompt there.`;
        }
        if (result.signal) {
          output += `\n\nTerminated by signal ${result.signal}.`;
        } else if (
          result.exitCode !== undefined &&
          result.exitCode !== null &&
          result.exitCode !== 0
        ) {
          output = `Exit code ${result.exitCode}\n${output}`;
        }
        if (result.timedOut) {
          output += `\n\nCommand timed out after ${Math.round(
            timeoutMs / 1000,
          )} seconds.`;
        }
        return output;
      } finally {
        emitBashToolEnded();
      }
    }

    emitBashToolStarted();

    const terminalOutput: string = await new Promise((resolve, reject) => {
      // Use same shell logic as core implementation
      const { shell, args } = getShellCommand(command);
      const child = spawn(shell, args);
      let stdout = "";
      let stderr = "";
      let timeoutId: NodeJS.Timeout;
      let isResolved = false;

      // Determine timeout: use provided timeout (capped at 600s), test env variable, or default 180s
      const TIMEOUT_MS = resolveBashTimeoutMs(timeout);

      /**
       * Appends a note about reduced limits when parallel tool calls are in effect.
       */
      const appendParallelLimitNote = (output: string): string =>
        parallelLimitNote(output, parallelCount, baseMaxChars, baseMaxLines);

      const moveToBackground = () => {
        if (isResolved) return;
        isResolved = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        backgroundSignalManager.off("backgroundRequested", moveToBackground);

        // Detach stdout/stderr listeners so they don't accumulate in local
        // buffers or trigger chat history updates after the tool call resolves.
        // BackgroundJobService.createJobWithProcess attaches its own listeners.
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);

        const job = backgroundJobService.createJobWithProcess(
          command,
          child as ChildProcess,
          stdout,
        );

        if (job) {
          const truncationResult = truncateOutputFromStart(stdout, {
            maxChars,
            maxLines,
          });
          const outputSoFar = truncationResult.wasTruncated
            ? appendParallelLimitNote(truncationResult.output)
            : truncationResult.output;
          resolve(
            `Command moved to background. Job ID: ${job.id}\nOutput so far:\n${outputSoFar}\nUse CheckBackgroundJob("${job.id}") to check status.`,
          );
        } else {
          resolve(
            `Failed to move to background (job limit reached). Command continues in foreground.\nOutput so far: ${stdout}`,
          );
        }
      };

      backgroundSignalManager.on("backgroundRequested", moveToBackground);

      const resetTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
          if (isResolved) return;
          isResolved = true;
          child.kill();
          let output = stdout + (stderr ? `\nStderr: ${stderr}` : "");
          output += `\n\n[Command timed out after ${TIMEOUT_MS / 1000} seconds of no output]`;

          const truncationResult = truncateOutputFromStart(output, {
            maxChars,
            maxLines,
          });
          const finalOutput = truncationResult.wasTruncated
            ? appendParallelLimitNote(truncationResult.output)
            : truncationResult.output;
          resolve(finalOutput);
        }, TIMEOUT_MS);
      };

      const showCurrentOutput = () => {
        if (!context?.toolCallId) return;
        try {
          const currentOutput = stdout + (stderr ? `\nStderr: ${stderr}` : "");
          services.chatHistory.addToolResult(
            context.toolCallId,
            currentOutput,
            "calling",
          );
        } catch {
          // Ignore errors during streaming updates
        }
      };

      // Start the initial timeout
      resetTimeout();

      const onStdout = (data: Buffer) => {
        stdout += data.toString();
        resetTimeout();
        showCurrentOutput();
      };

      const onStderr = (data: Buffer) => {
        stderr += data.toString();
        resetTimeout();
        showCurrentOutput();
      };

      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);

      child.on("close", (code) => {
        if (isResolved) return;
        isResolved = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        backgroundSignalManager.removeListener(
          "backgroundRequested",
          moveToBackground,
        );

        // Only reject on non-zero exit code if there's also stderr
        if (code !== 0 && stderr) {
          reject(`Error (exit code ${code}): ${stderr}`);
          return;
        }

        // Track specific git operations only after successful execution
        if (code === 0) {
          if (isGitCommitCommand(command)) {
            telemetryService.recordCommitCreated();
          } else if (isPullRequestCommand(command)) {
            telemetryService.recordPullRequestCreated();
          }
        }

        let output = stdout;
        if (stderr) {
          output = stdout + `\nStderr: ${stderr}`;
        }

        const truncationResult = truncateOutputFromStart(output, {
          maxChars,
          maxLines,
        });
        const finalOutput = truncationResult.wasTruncated
          ? appendParallelLimitNote(truncationResult.output)
          : truncationResult.output;
        resolve(finalOutput);
      });

      child.on("error", (error) => {
        if (isResolved) return;
        isResolved = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        backgroundSignalManager.off("backgroundRequested", moveToBackground);
        reject(`Error: ${error.message}`);
      });
    });

    emitBashToolEnded();

    return terminalOutput;
  },
};
