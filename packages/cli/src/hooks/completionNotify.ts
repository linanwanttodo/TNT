import { spawn } from "child_process";

import { readSettingsStringArray } from "../config/settingsFiles.js";
import { getCurrentSessionId } from "../session/index.js";
import { logger } from "../utils/logger.js";

/**
 * What a notify command receives as its final argv element, so a script can
 * read it with a single JSON.parse of the last argument (Codex's contract).
 */
export interface CompletionNotifyPayload {
  type: "agent-turn-complete";
  sessionId: string;
  lastAssistantMessage: string;
}

export const NOTIFY_TIMEOUT_MS = 5000;

/**
 * The notify command from the settings cascade: a list of strings, executable
 * first. A later settings file replaces an earlier one, so a project can point
 * the notification somewhere else without merging two commands.
 */
export function configuredNotifyCommand(
  cwd?: string,
  homeDir?: string,
): string[] | undefined {
  const parts = readSettingsStringArray("notify", cwd, homeDir);
  return parts && parts.length > 0 ? parts : undefined;
}

export function buildNotifyPayload(
  lastAssistantMessage: string,
  sessionId: string,
): CompletionNotifyPayload {
  return { type: "agent-turn-complete", sessionId, lastAssistantMessage };
}

/**
 * Runs the configured notify command once the turn is done. It never fails
 * the run and never throws: the answer is already complete, so a notification
 * that cannot start or hangs is logged and dropped rather than turned into a
 * failed exit code or a process that will not exit.
 */
export async function runCompletionNotify(
  lastAssistantMessage: string,
  options: {
    command?: string[];
    spawnFn?: typeof spawn;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const command = options.command ?? configuredNotifyCommand();
  if (!command || command.length === 0) return;

  const [executable, ...args] = command;
  const payload = buildNotifyPayload(
    lastAssistantMessage,
    getCurrentSessionId(),
  );
  const spawnFn = options.spawnFn ?? spawn;
  const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS;

  try {
    const child = spawnFn(executable, [...args, JSON.stringify(payload)], {
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        logger.debug("Completion notify timed out and was stopped");
        resolve();
      }, timeoutMs);
      child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        logger.debug("Completion notify could not run:", error);
        resolve();
      });
    });
  } catch (error) {
    logger.debug("Completion notify failed:", error);
  }
}
