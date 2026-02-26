import { TntError, TntErrorReason } from "core/util/errors.js";
import { ChatCompletionToolMessageParam } from "openai/resources/chat/completions.mjs";

import { firePreToolUse } from "../hooks/fireHook.js";
import { ToolPermissions } from "../permissions/types.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../services/index.js";
import type { ToolPermissionServiceState } from "../services/ToolPermissionService.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import {
  getAllAvailableTools,
  Tool,
  validateToolCallArgs,
} from "../tools/index.js";
import { repairToolInput } from "../tools/inputRepair.js";
import { MARKER_PERMISSION_DENIED } from "../tools/resultMarkers.js";
import { planToolCalls } from "../tools/specs/planner.js";
import { PreprocessedToolCall, ToolCall } from "../tools/types.js";
import { logger } from "../utils/logger.js";

import {
  checkToolPermissionApproval,
  ToolResultWithStatus,
} from "./permissionFlow.js";
import { StreamCallbacks } from "./streamChatResponse.types.js";
import { dispatchApprovedCall, noteToolUpdate } from "./toolDispatch.js";

export async function preprocessStreamedToolCalls(
  isHeadless: boolean,
  toolCalls: ToolCall[],
  callbacks?: StreamCallbacks,
  canDelegate: boolean = true,
): Promise<{
  preprocessedCalls: PreprocessedToolCall[];
  errorChatEntries: ChatCompletionToolMessageParam[];
}> {
  const preprocessedCalls: PreprocessedToolCall[] = [];
  const errorChatEntries: ChatCompletionToolMessageParam[] = [];

  // Composed once for the batch: every call validates against the same list,
  // and rebuilding it per call re-ran the capability probes and MCP snapshot.
  const availableTools: Tool[] = toolCalls.length
    ? await getAllAvailableTools(isHeadless, canDelegate)
    : [];

  // Process each tool call
  for (const toolCall of toolCalls) {
    const startTime = Date.now();
    try {
      const tool = availableTools.find((t) => t.name === toolCall.name);
      if (!tool) {
        throw new TntError(
          TntErrorReason.ToolNotFound,
          `Tool ${toolCall.name} not found. It is either not installed or withheld from this mode; the tools you can call are the ones in this run's tool list.`,
        );
      }

      // Repair the shapes a model gets structurally wrong but semantically
      // right before validation turns them into a lost round. Renaming a
      // near-miss key is deliberately not part of this: the validator names
      // the arrived key and the wanted one, and guessing could write the
      // wrong field.
      const repaired = repairToolInput(toolCall.arguments, tool.parameters);
      if (repaired.repairs.length > 0) {
        logger.debug("Repaired tool argument shapes", {
          name: toolCall.name,
          repairs: repaired.repairs,
        });
        toolCall.arguments = repaired.input;
      }

      validateToolCallArgs(toolCall, tool);

      const preprocessedCall: PreprocessedToolCall = {
        ...toolCall,
        tool,
      };

      if (tool.preprocess) {
        logger.debug("Preprocessing tool call args", {
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
        const preprocessed = await tool.preprocess(toolCall.arguments);
        preprocessedCall.preprocessResult = preprocessed;
      }

      preprocessedCalls.push(preprocessedCall);
    } catch (error) {
      // Notify the UI about the tool start, even though it failed
      callbacks?.onToolStart?.(toolCall.name, toolCall.arguments, toolCall.id);
      noteToolUpdate(callbacks, toolCall.name, "calling", {
        toolCallId: toolCall.id,
      });

      const errorReason =
        error instanceof TntError ? error.reason : TntErrorReason.Unknown;

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("Invalid tool call", {
        name: toolCall.name,
        error: errorMessage,
      });

      const duration = Date.now() - startTime;
      telemetryService.logToolResult({
        toolName: toolCall.name,
        success: false,
        durationMs: duration,
        error: errorMessage,
        errorReason,
        // modelName, TODO
      });
      // Add error to chat history
      errorChatEntries.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: errorMessage,
      });

      // Notify about the error
      callbacks?.onToolError?.(errorMessage, toolCall.name);
      noteToolUpdate(callbacks, toolCall.name, "errored", {
        toolCallId: toolCall.id,
        result: errorMessage,
      });
    }
  }

  return { preprocessedCalls, errorChatEntries };
}

/**
 * Resolves one call's permission phase and dispatches it when approved.
 *
 * The PreToolUse hook runs before the permission check, like the reference:
 * it may block the call, rewrite its input, or allow it without a prompt. The
 * rewritten input is what the permission check sees and what actually
 * executes. A denial - by policy, a hook or the user - is recorded as a
 * canceled entry and reported as a rejection; every other path dispatches the
 * call and reports no rejection. A permission-check failure is settled as an
 * errored entry without stopping the batch and without counting as a
 * rejection.
 */
async function approveAndDispatchCall(options: {
  index: number;
  call: PreprocessedToolCall;
  plannedKeys: readonly string[];
  parallelCount: number;
  execution?: {
    permissions?: ToolPermissions;
    autoContext?: { llmApi?: any; model?: any; history?: any[] };
  };
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
  entriesByIndex: Map<number, ToolResultWithStatus>;
  execPromises: Array<Promise<void>>;
  onToolOutcome?: (
    toolName: string,
    succeeded: boolean,
    error?: unknown,
  ) => void;
}): Promise<boolean> {
  const {
    index,
    call,
    plannedKeys,
    parallelCount,
    execution,
    callbacks,
    isHeadless,
    entriesByIndex,
    execPromises,
    onToolOutcome,
  } = options;

  try {
    logger.debug("Checking tool permissions", {
      name: call.name,
      arguments: call.arguments,
    });

    // Notify tool start before permission check to display in UI fallbacks
    callbacks?.onToolStart?.(call.name, call.arguments, call.id);
    noteToolUpdate(callbacks, call.name, "calling", { toolCallId: call.id });

    const preHook = await firePreToolUse(call.name, call.arguments, call.id);
    const effectiveCall = preHook.updatedInput
      ? { ...call, arguments: preHook.updatedInput }
      : call;

    if (preHook.blocked) {
      const blockMessage = preHook.blockReason ?? `Hook blocked ${call.name}`;
      entriesByIndex.set(index, {
        role: "tool",
        tool_call_id: call.id,
        content: blockMessage,
        status: "canceled",
      });
      callbacks?.onToolResult?.(blockMessage, call.name, "canceled", call.id);
      noteToolUpdate(callbacks, call.name, "canceled", {
        toolCallId: call.id,
        result: blockMessage,
      });
      try {
        services.chatHistory.addToolResult(call.id, blockMessage, "canceled");
      } catch {}
      return false;
    }

    // Check tool permissions using helper
    const permissionState =
      execution?.permissions ??
      (
        await serviceContainer.get<ToolPermissionServiceState>(
          SERVICE_NAMES.TOOL_PERMISSIONS,
        )
      ).permissions;
    const permissionResult =
      preHook.permissionDecision === "allow"
        ? { approved: true as const }
        : await checkToolPermissionApproval(
            permissionState,
            effectiveCall,
            callbacks,
            isHeadless,
            {
              hookAskReason:
                preHook.permissionDecision === "ask"
                  ? preHook.permissionDecisionReason ||
                    "A PreToolUse hook asked you to confirm this call."
                  : undefined,
              autoContext: execution?.autoContext,
            },
          );

    if (!permissionResult.approved) {
      // Permission denied: create entry with canceled status
      const denialReason = permissionResult.denialReason || "user";
      const deniedMessage =
        permissionResult.message ??
        (denialReason === "policy"
          ? `Command blocked by security policy`
          : MARKER_PERMISSION_DENIED);

      const deniedEntry: ToolResultWithStatus = {
        role: "tool",
        tool_call_id: call.id,
        content: deniedMessage,
        status: "canceled",
      };
      entriesByIndex.set(index, deniedEntry);
      callbacks?.onToolResult?.(
        String(deniedEntry.content),
        call.name,
        "canceled",
        call.id,
      );
      noteToolUpdate(callbacks, call.name, "canceled", {
        toolCallId: call.id,
        result: String(deniedEntry.content),
      });
      // Immediate service update for UI feedback
      try {
        services.chatHistory.addToolResult(
          call.id,
          String(deniedEntry.content),
          "canceled",
        );
      } catch {}
      return true;
    }

    // Immediately mark as calling for instant UI feedback
    try {
      services.chatHistory.updateToolStatus(call.id, "calling");
    } catch {}

    // Start execution immediately for approved calls. The dispatch runs the
    // whole call - execute, spill, post hooks, publishing - on its own, so
    // one failing call never discards the calls that already finished.
    execPromises[index] = dispatchApprovedCall({
      index,
      call,
      effectiveCall,
      plannedKeys,
      parallelCount,
      preHook,
      entriesByIndex,
      callbacks,
      onToolOutcome,
    });
    return false;
  } catch (error) {
    const errorMessage = `Error checking permissions for ${call.name}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.error("Permission check failed", {
      name: call.name,
      error: errorMessage,
    });
    entriesByIndex.set(index, {
      role: "tool",
      tool_call_id: call.id,
      content: errorMessage,
      status: "errored",
    });
    callbacks?.onToolError?.(errorMessage, call.name);
    noteToolUpdate(callbacks, call.name, "errored", {
      toolCallId: call.id,
      result: errorMessage,
    });
    // Treat permission errors like execution errors but do not stop the batch
    try {
      services.chatHistory.addToolResult(
        call.id,
        errorMessage as string,
        "errored",
      );
    } catch {}
    return false;
  }
}

/**
 * Executes preprocessed tool calls, handling permissions and results
 * @param preprocessedCalls - The preprocessed tool calls ready for execution
 * @param callbacks - Optional callbacks for notifying of events
 * @returns - Chat history entries with tool results and status information
 */
export async function executeStreamedToolCalls(
  preprocessedCalls: PreprocessedToolCall[],
  callbacks?: StreamCallbacks,
  isHeadless?: boolean,
  /**
   * Notified once per tool call with the outcome, so the caller can keep a
   * per-tool failure tally without this function knowing why it cares.
   */
  onToolOutcome?: (
    toolName: string,
    succeeded: boolean,
    error?: unknown,
  ) => void,
  /**
   * Execution context. `permissions` left unset uses the process-wide policy;
   * a delegated run passes its own narrowed policy, so the check at execution
   * time agrees with the tool list the model was shown. `autoContext` carries
   * the model used by the auto-mode classifier.
   */
  execution?: {
    permissions?: ToolPermissions;
    autoContext?: { llmApi?: any; model?: any; history?: any[] };
  },
): Promise<{
  hasRejection: boolean;
  chatHistoryEntries: ToolResultWithStatus[];
}> {
  // Permissions are checked sequentially and in order, because a rejection has
  // to be visible before the calls around it start. Once a call is approved it
  // is placed into the plan, which decides what may overlap it.
  //
  // NOTE: parallelToolCallCount is the size of the call's own step, not the size
  // of the batch, so a tool dividing its output budget by it does not shrink
  // because of unrelated calls it will never run alongside.
  const plan = planToolCalls(preprocessedCalls);
  const plannedByIndex = new Map(
    plan.all.map((planned) => [planned.index, planned]),
  );

  type IndexedCall = { index: number; call: PreprocessedToolCall };
  const indexedCalls: IndexedCall[] = preprocessedCalls.map((call, index) => ({
    index,
    call,
  }));

  const entriesByIndex = new Map<number, ToolResultWithStatus>();
  const execPromises: Array<Promise<void>> = [];

  let hasRejection = false;

  // Permission phase (sequential)
  for (const { index, call } of indexedCalls) {
    // Do not cancel subsequent tools after a rejection; handle each independently
    const planned = plannedByIndex.get(index);
    const rejected = await approveAndDispatchCall({
      index,
      call,
      plannedKeys: planned?.keys ?? [],
      parallelCount: planned?.parallelCount ?? 1,
      execution,
      callbacks,
      isHeadless,
      entriesByIndex,
      execPromises,
      onToolOutcome,
    });
    if (rejected) {
      hasRejection = true;
    }
  }

  // Walk the plan in order. Unserialized calls start together; a call holding
  // a slot waits for everything ahead of it to settle first. Each promise
  // resolves on its own, so one failing call never discards the results of the
  // calls that already finished.
  for (const step of plan.steps) {
    const running = step.calls
      .map((planned) => execPromises[planned.index])
      .filter((promise): promise is Promise<void> => !!promise);
    await Promise.allSettled(running);
  }
  await Promise.allSettled(execPromises.filter((p) => !!p));

  // Assemble final entries in original order
  const chatHistoryEntries: ToolResultWithStatus[] = preprocessedCalls
    .map((_, index) => entriesByIndex.get(index))
    .filter((e): e is ToolResultWithStatus => !!e);

  return {
    hasRejection,
    chatHistoryEntries,
  };
}
