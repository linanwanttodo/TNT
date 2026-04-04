import { CompletionOptions } from "@tnt/config-yaml";
import type { ToolStatus } from "core/index.js";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources.mjs";

import type { TerminationReason } from "../loop/termination.js";
import type { ToolPermissions } from "../permissions/types.js";
import type { PermissionMode } from "../permissions/types.js";
import { ToolCallPreview } from "../tools/types.js";

export interface StreamCallbacks {
  onContent?: (content: string) => void;
  /**
   * A reasoning delta, when the provider separates it from the answer. The
   * surface folds it; it is never appended to the assistant text.
   */
  onReasoning?: (delta: string) => void;
  /**
   * The round's reasoning is finished, whether or not it produced any answer
   * text. A round that only calls tools ends with empty content, so a surface
   * cannot infer this from `onContentComplete`.
   */
  onReasoningComplete?: () => void;
  onContentComplete?: (content: string) => void;
  onToolStart?: (toolName: string, toolArgs?: any, toolCallId?: string) => void;
  /**
   * A tool status change, for a surface that renders the lifecycle rather
   * than only the start and the result.
   */
  onToolUpdate?: (update: {
    toolCallId?: string;
    toolName: string;
    status: ToolStatus;
    result?: string;
  }) => void;
  onToolResult?: (
    result: string,
    toolName: string,
    status: ToolStatus,
    toolCallId?: string,
  ) => void;
  onToolError?: (error: string, toolName?: string) => void;
  onToolPermissionRequest?: (
    toolName: string,
    toolArgs: any,
    requestId: string,
    preview?: ToolCallPreview[],
    toolCallId?: string,
  ) => void;
  onSystemMessage?: (message: string) => void;
  /**
   * Consulted once per completed tool result; a returned string is appended
   * to that result as a <system-reminder>, so a reminder travels in the
   * request tail rather than in the cached prefix. `argumentsJson` is the
   * document the tool ran with, including any PreToolUse rewrite.
   */
  onTailReminder?: (
    toolName: string,
    argumentsJson: string,
  ) => string | undefined;
  /**
   * Called once when the turn ends, with the reason. A turn cut short by a
   * step ceiling or a stalled loop still returns its partial text, so this is
   * how a caller learns to label that text as incomplete.
   */
  onTurnTerminated?: (
    reason: TerminationReason,
    detail?: { maxSteps?: number; notice?: string },
  ) => void;
}

/**
 * Values that differ for a delegated run.
 *
 * A top-level turn leaves these unset and reads the process-wide services. A
 * delegated run passes them so two concurrent delegations cannot overwrite each
 * other's system prompt or permissions.
 */
export interface StreamRunOverrides {
  /** System prompt for this run, already resolved. */
  readonly systemMessage?: string;
  /**
   * Permission mode frozen at run start. Reading the live service between
   * rounds let a mode switch change the system prompt mid-turn.
   */
  readonly mode?: PermissionMode;
  /** Whether this run has an interactive approver. Defaults to the global. */
  readonly isHeadless?: boolean;
  /**
   * Permissions for this run. Defaults to the global. A delegated run passes
   * its own narrowed policy so it cannot widen its own scope, and so two
   * concurrent delegations do not read each other's permissions.
   */
  readonly permissions?: ToolPermissions;
  /**
   * Whether this run may delegate again. False at the depth limit, which keeps
   * the delegation tool out of the tool list entirely.
   */
  readonly canDelegate?: boolean;
}

export function getDefaultCompletionOptions(
  opts?: CompletionOptions,
): Partial<ChatCompletionCreateParamsStreaming> {
  if (!opts) return {};
  return {
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    frequency_penalty: opts.frequencyPenalty,
    presence_penalty: opts.presencePenalty,
    top_p: opts.topP,
  };
}
