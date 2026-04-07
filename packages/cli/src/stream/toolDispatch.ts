import { firePostToolUse, firePostToolUseFailure } from "../hooks/fireHook.js";
import type { HookEventResult } from "../hooks/types.js";
import { services } from "../services/index.js";
import { executeToolCall } from "../tools/index.js";
import { ExecutionGate } from "../tools/specs/gate.js";
import type { PreprocessedToolCall } from "../tools/types.js";
import { logger } from "../utils/logger.js";

import type { ToolResultWithStatus } from "./permissionFlow.js";
import { postEditDiagnostics } from "./postEditDiagnostics.js";
import type { StreamCallbacks } from "./streamChatResponse.types.js";
import {
  imageObservationContent,
  normalizeToolResult,
} from "./toolResultMedia.js";
import { spillOversizedToolResult } from "./toolResultStorage.js";

/**
 * One gate per process. The gate is stateless across turns, so a slot left
 * unclaimed by a crashed turn cannot leak into the next one.
 */
const executionGate = new ExecutionGate();

/**
 * Reports a lifecycle change to a surface that renders tool state. The older
 * start/result/error callbacks remain, so this is additive.
 */
export function noteToolUpdate(
  callbacks: StreamCallbacks | undefined,
  toolName: string,
  status: ToolResultWithStatus["status"],
  options: { toolCallId?: string; result?: string } = {},
): void {
  callbacks?.onToolUpdate?.({
    toolName,
    status,
    ...options,
  });
}

function withHookContext(
  content: string,
  parts: Array<[string, string | undefined]>,
): string {
  const notes = parts
    .filter(([, text]) => text?.trim())
    .map(
      ([hookName, text]) =>
        `<system-reminder>${hookName} hook additional context: ${text?.trim()}</system-reminder>`,
    );
  return notes.length > 0 ? `${content}\n\n${notes.join("\n\n")}` : content;
}

/**
 * Runs one approved tool call to completion: execute inside the concurrency
 * gate, spill an oversized result, run the PostToolUse hook, then publish the
 * result - or the failure, with the PostToolUseFailure hook's context - to the
 * entries map, the callbacks and the chat history service.
 *
 * `effectiveCall` is the call as rewritten by the PreToolUse hook; that is
 * what executes and what the permission check saw.
 */
export async function dispatchApprovedCall(options: {
  index: number;
  call: PreprocessedToolCall;
  effectiveCall: PreprocessedToolCall;
  /** Concurrency keys this call's plan step holds. */
  plannedKeys: readonly string[];
  /** Size of the call's own step, not of the whole batch. */
  parallelCount: number;
  preHook: HookEventResult;
  entriesByIndex: Map<number, ToolResultWithStatus>;
  callbacks?: StreamCallbacks;
  onToolOutcome?: (
    toolName: string,
    succeeded: boolean,
    error?: unknown,
  ) => void;
  /** The run's abort signal: a tool that honours it stops when the deadline fires. */
  signal?: AbortSignal;
}): Promise<void> {
  const {
    index,
    call,
    effectiveCall,
    plannedKeys,
    parallelCount,
    preHook,
    entriesByIndex,
    callbacks,
    onToolOutcome,
    signal,
  } = options;

  try {
    logger.debug("Executing tool", {
      name: effectiveCall.name,
      arguments: effectiveCall.arguments,
    });

    const toolResult = await executionGate.run(plannedKeys, () =>
      executeToolCall(effectiveCall, {
        parallelToolCallCount: parallelCount,
        signal,
      }),
    );
    const { content: resultText, images } = normalizeToolResult(toolResult);
    // The model is given a preview of anything oversized before the hook
    // notes are appended, so a hook's context is never the part that gets
    // cut - and the post hook still sees the result whole.
    const stowed = await spillOversizedToolResult({
      toolName: effectiveCall.name,
      callId: call.id,
      content: resultText,
    });
    // The post hook runs before the result is published so its context
    // can join the answer the model reads; the UI sees the call a hook's
    // runtime later, which is the same delay the permission phase allows.
    const postHook = await firePostToolUse(
      effectiveCall.name,
      effectiveCall.arguments,
      resultText,
      call.id,
    );
    const diagnostics = await postEditDiagnostics(
      effectiveCall.name,
      effectiveCall.arguments,
    );
    const withDiagnostics = diagnostics
      ? `${stowed}\n\n${diagnostics}`
      : stowed;
    // The effective call, not the parsed request: a PreToolUse hook can rewrite
    // the input, and the advice is about the call that actually ran.
    const reminder = callbacks?.onTailReminder?.(
      effectiveCall.name,
      JSON.stringify(effectiveCall.arguments),
    );
    const content = withHookContext(
      reminder
        ? `${withDiagnostics}\n\n<system-reminder>${reminder}</system-reminder>`
        : withDiagnostics,
      [
        [`PreToolUse:${effectiveCall.name}`, preHook.additionalContext],
        [`PostToolUse:${effectiveCall.name}`, postHook.additionalContext],
      ],
    );
    const entry: ToolResultWithStatus = {
      role: "tool",
      tool_call_id: call.id,
      content,
      status: "done",
    };
    entriesByIndex.set(index, entry);
    callbacks?.onToolResult?.(content, call.name, "done", call.id);
    noteToolUpdate(callbacks, call.name, "done", {
      toolCallId: call.id,
      result: content,
    });
    onToolOutcome?.(call.name, true);
    // Immediate service update for UI feedback
    try {
      services.chatHistory.addToolResult(call.id, content, "done");
      if (images.length > 0) {
        services.chatHistory.addUserMessage(
          imageObservationContent(effectiveCall.name, images),
        );
      }
    } catch {}
  } catch (error) {
    const errorMessage = `Error executing tool ${call.name}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    onToolOutcome?.(call.name, false, error);
    logger.error("Tool execution failed", {
      name: call.name,
      error: errorMessage,
    });
    const failureHook = await firePostToolUseFailure(
      effectiveCall.name,
      effectiveCall.arguments,
      call.id,
      errorMessage,
    );
    const content = withHookContext(errorMessage, [
      [`PreToolUse:${effectiveCall.name}`, preHook.additionalContext],
      [
        `PostToolUseFailure:${effectiveCall.name}`,
        failureHook.additionalContext,
      ],
    ]);
    entriesByIndex.set(index, {
      role: "tool",
      tool_call_id: call.id,
      content,
      status: "errored",
    });
    callbacks?.onToolError?.(content, call.name);
    noteToolUpdate(callbacks, call.name, "errored", {
      toolCallId: call.id,
      result: content,
    });
    // Immediate service update for UI feedback
    try {
      services.chatHistory.addToolResult(call.id, content, "errored");
    } catch {}
  }
}
