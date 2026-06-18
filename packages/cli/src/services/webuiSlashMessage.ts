import type { AssistantConfig } from "@tnt/sdk";

import { classifySlashResult } from "../commands/slashCommandResult.js";
import { compactHistoryOnce } from "../compaction/manual.js";
import { t } from "../i18n/index.js";
import type { AgentEvent } from "../protocol/events.js";

import { services } from "./index.js";

/**
 * What the message route should do with a posted message after the slash
 * dispatch has looked at it.
 */
export type WebUiSlashEffect =
  | { kind: "prompt"; prompt: string }
  | {
      kind: "answered";
      payload: Record<string, unknown>;
      /** Text for the transcript's notice row, when there is something to say. */
      notice: string | null;
      /** Set when the transcript itself changed and every tab must reload. */
      sessionChanged?: boolean;
    };

/** A `notice` event carrying the session the browser is looking at. */
export function webUiNotice(sessionId: string, message: string): AgentEvent {
  return {
    sessionId,
    turnId: `notice-${Date.now()}`,
    seq: 0,
    timestamp: Date.now(),
    type: "notice",
    message,
  };
}

/**
 * Dispatch a browser message as a slash command when it starts with one.
 *
 * The browser has no picker screens, so a command that would open one is
 * answered with a notice instead of being sent to the model as a prompt - the
 * behaviour the terminal has, minus the screens. Print commands land in the
 * transcript as a system message, which is the same place the terminal puts
 * their output.
 */
export async function applyWebUiSlashCommand(
  message: string,
  assistant: AssistantConfig | null,
): Promise<WebUiSlashEffect> {
  if (!assistant || !message.trimStart().startsWith("/")) {
    return { kind: "prompt", prompt: message };
  }

  // Imported at call time on purpose: the command handlers' module graph
  // reaches back into services (the /webui handler holds the WebUiService,
  // which mounts these routes), so a static edge here closes a loop that
  // breaks module initialisation.
  const { handleSlashCommands } = await import("../ui/commands/index.js");

  const commandResult = await handleSlashCommands(message, assistant);
  if (!commandResult) {
    return { kind: "prompt", prompt: message };
  }

  const outcome = classifySlashResult(commandResult);
  switch (outcome.kind) {
    case "prompt":
      return { kind: "prompt", prompt: outcome.prompt };

    case "print":
      services.chatHistory.addSystemMessage(outcome.output);
      return {
        kind: "answered",
        payload: { queued: false, output: outcome.output },
        notice: null,
        sessionChanged: true,
      };

    case "clear":
      services.chatHistory.clear();
      return {
        kind: "answered",
        payload: { queued: false, cleared: true },
        notice: t("chat.commandCleared"),
        sessionChanged: true,
      };

    case "compact": {
      const modelState = services.model.getState();
      if (!modelState.model || !modelState.llmApi) {
        return {
          kind: "answered",
          payload: { queued: false, compacted: false },
          notice: t("chat.commandNeedsTui", { command: message.trim() }),
        };
      }
      try {
        const result = await compactHistoryOnce(
          services.chatHistory.getHistory(),
          modelState.model,
          modelState.llmApi,
          (compacted, compactionIndex) =>
            services.chatHistory.compact(compacted, compactionIndex),
        );
        return {
          kind: "answered",
          payload: {
            queued: false,
            compacted: true,
            historyLength: result.historyLength,
          },
          notice: t("chat.compacted"),
          sessionChanged: true,
        };
      } catch (error) {
        return {
          kind: "answered",
          payload: { queued: false, compacted: false },
          notice: `Compaction failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }

    case "exit":
      return {
        kind: "answered",
        payload: { queued: false, exit: true },
        notice: t("session.goodbye"),
      };

    case "unsupported":
      return {
        kind: "answered",
        payload: { queued: false, unsupported: true },
        notice: t("chat.commandNeedsTui", { command: message.trim() }),
      };
  }
}
