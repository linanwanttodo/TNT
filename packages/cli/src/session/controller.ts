import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";

import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import { captureRunSnapshot } from "../config/snapshot.js";
import {
  isNormalTermination,
  type TerminationReason,
} from "../loop/termination.js";
import type { TurnBudgetLimits } from "../loop/turnBudget.js";
import { publishAgentEvent } from "../protocol/eventBus.js";
import type { AgentEvent } from "../protocol/events.js";
import { createAgentEventStream } from "../stream/eventAdapter.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";
import type {
  StreamCallbacks,
  StreamRunOverrides,
} from "../stream/streamChatResponse.types.js";

export interface AgentTurnOptions {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  llmApi: BaseLlmApi;
  /** Left unset, the controller creates one so `interrupt` always has a handle. */
  abortController?: AbortController;
  callbacks?: StreamCallbacks;
  isCompacting?: boolean;
  turnBudgetLimits?: Partial<TurnBudgetLimits>;
  runOverrides?: StreamRunOverrides;
  /** Defaults to the prompt cache key, which is the session-wide slot. */
  sessionId?: string;
  turnId?: string;
  /** An extra sink for one caller; the process-wide bus also receives events. */
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentTurnController {
  readonly sessionId: string;
  readonly turnId: string;
  readonly abortController: AbortController;
  /** Settles with the turn's text when the engine returns. */
  readonly done: Promise<string>;
  interrupt(reason?: string): void;
}

let turnCounter = 0;

function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${Date.now()}-${turnCounter}`;
}

/** The text of the history item this turn answers, when it has one. */
function lastUserInput(
  history: readonly ChatHistoryItem[],
): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]?.message;
    if (message?.role !== "user") {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content || undefined;
    }
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return text || undefined;
  }
  return undefined;
}

/**
 * Starts one engine turn behind the event contract.
 *
 * This is the only module in the CLI allowed to import
 * `streamChatResponse`. A surface either awaits `runAgentTurn` or holds the
 * handle and listens/aborts; neither one knows the loop's callbacks.
 */
export function startAgentTurn(options: AgentTurnOptions): AgentTurnController {
  const sessionId = options.sessionId ?? currentPromptCacheKey() ?? "session";
  const snapshot = captureRunSnapshot({
    sessionId,
    mode: options.runOverrides?.mode,
    isHeadless: options.runOverrides?.isHeadless,
  });
  const runOverrides: StreamRunOverrides = {
    ...options.runOverrides,
    mode: options.runOverrides?.mode ?? snapshot.mode,
    isHeadless: options.runOverrides?.isHeadless ?? snapshot.isHeadless,
  };
  const turnId = options.turnId ?? nextTurnId();
  const abortController = options.abortController ?? new AbortController();

  const emit = (event: AgentEvent) => {
    publishAgentEvent(event);
    options.onEvent?.(event);
  };

  const events = createAgentEventStream({ sessionId, turnId, emit });
  const userInput = lastUserInput(options.chatHistory);
  events.publish({
    type: "turn.started",
    model: options.model.model,
    historyLength: options.chatHistory.length,
    ...(userInput ? { userInput } : {}),
  });

  const terminationRef: {
    current: { reason: TerminationReason; notice?: string } | null;
  } = { current: null };

  const inner = options.callbacks;
  const callbacks: StreamCallbacks = {
    ...events.callbacks({
      ...inner,
      onTurnTerminated: (reason, detail) => {
        terminationRef.current = { reason, notice: detail?.notice };
        inner?.onTurnTerminated?.(reason, detail);
      },
    }),
  };

  const done = (async () => {
    try {
      const response = await streamChatResponse(
        options.chatHistory,
        options.model,
        options.llmApi,
        abortController,
        callbacks,
        options.isCompacting ?? false,
        options.turnBudgetLimits,
        runOverrides,
      );

      if (terminationRef.current) {
        // The stream loop reports its exit reason for every turn, including
        // the ordinary no-tool-calls ending; only truncations are interrupts.
        const { reason, notice } = terminationRef.current;
        if (isNormalTermination(reason as TerminationReason)) {
          events.publish({ type: "turn.completed", content: response });
        } else {
          events.publish({ type: "turn.interrupted", reason, notice });
        }
      } else if (abortController.signal.aborted) {
        events.publish({ type: "turn.interrupted", reason: "user_abort" });
      } else {
        events.publish({ type: "turn.completed", content: response });
      }

      return response;
    } catch (error) {
      events.publish({
        type: "turn.failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  })();

  return {
    sessionId,
    turnId,
    abortController,
    done,
    interrupt: (reason = "user_abort") => {
      abortController.abort(reason);
    },
  };
}

/** Convenience for a surface that only needs the text. */
export async function runAgentTurn(options: AgentTurnOptions): Promise<string> {
  return startAgentTurn(options).done;
}
