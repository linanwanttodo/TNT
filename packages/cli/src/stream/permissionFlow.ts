import type { ToolStatus } from "core/index.js";
import { ChatCompletionToolMessageParam } from "openai/resources/chat/completions.mjs";

import { fireNotification, firePermissionRequest } from "../hooks/fireHook.js";
import { t } from "../i18n/index.js";
import {
  AUTO_SAFE_TOOLS,
  autoModeShouldPrompt,
  classifyAutoAction,
  noteAutoDenial,
  noteAutoSuccess,
} from "../permissions/autoMode.js";
import { ACCEPT_EDITS_MODE_POLICIES } from "../permissions/defaultPolicies.js";
import { checkToolPermission } from "../permissions/permissionChecker.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import { hasSessionApproval } from "../permissions/sessionApprovals.js";
import { ToolCallRequest, ToolPermissions } from "../permissions/types.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../services/index.js";
import { MARKER_PERMISSION_DENIED } from "../tools/resultMarkers.js";
import { PreprocessedToolCall } from "../tools/types.js";
import { logger } from "../utils/logger.js";

import { StreamCallbacks } from "./streamChatResponse.types.js";

export interface ToolResultWithStatus extends ChatCompletionToolMessageParam {
  status: ToolStatus;
}

export function handlePermissionDenied(
  toolCall: PreprocessedToolCall,
  chatHistoryEntries: ChatCompletionToolMessageParam[],
  callbacks?: StreamCallbacks,
  reason: "user" | "policy" = "user",
): void {
  const deniedMessage =
    reason === "policy"
      ? `Command blocked by security policy`
      : MARKER_PERMISSION_DENIED;

  logger.info("Tool call denied", {
    name: toolCall.name,
    arguments: toolCall.arguments,
    reason,
  });

  chatHistoryEntries.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: deniedMessage,
  });

  callbacks?.onToolResult?.(
    deniedMessage,
    toolCall.name,
    "canceled",
    toolCall.id,
  );
  logger.debug(`Tool call rejected (${reason}) - stopping stream`);
}

// Helper function to request user permission
export async function requestUserPermission(
  toolCall: PreprocessedToolCall,
  callbacks?: StreamCallbacks,
  note?: string,
): Promise<boolean> {
  if (!callbacks?.onToolPermissionRequest) {
    return false;
  }

  const basePreview = toolCall.preprocessResult?.preview;
  const toolCallRequest: ToolCallRequest = {
    name: toolCall.name,
    arguments: toolCall.preprocessResult?.args ?? toolCall.arguments,
    // A hook that demanded this prompt owes the user its reason.
    preview: note
      ? [{ type: "text" as const, content: note }, ...(basePreview ?? [])]
      : basePreview,
  };

  // Set up listener for permissionRequested event
  const handlePermissionRequested = (event: {
    requestId: string;
    toolCall: ToolCallRequest;
  }) => {
    if (event.toolCall.name === toolCall.name) {
      toolPermissionManager.off(
        "permissionRequested",
        handlePermissionRequested,
      );
      // Notify UI about permission request
      callbacks.onToolPermissionRequest!(
        event.toolCall.name,
        event.toolCall.arguments,
        event.requestId,
        event.toolCall.preview,
        toolCall.id,
      );
    }
  };

  toolPermissionManager.on("permissionRequested", handlePermissionRequested);

  // Request permission using the proper API
  const permissionResult =
    await toolPermissionManager.requestPermission(toolCallRequest);

  // Clean up listener in case the condition above was never met
  // This is a safety net to ensure no listeners are left behind
  toolPermissionManager.off("permissionRequested", handlePermissionRequested);

  return permissionResult.approved;
}

/**
 * Auto mode's decision for a call the base policy would ask about. The order
 * follows the reference implementation: deterministic fast paths first, the
 * model only for what is left, and a failure never counts as consent.
 */
async function resolveAutoModeDecision(
  toolCall: PreprocessedToolCall,
  autoContext?: { llmApi?: any; model?: any; history?: any[] },
): Promise<
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "prompt"; reason: string }
> {
  if (AUTO_SAFE_TOOLS.has(toolCall.name)) {
    return { kind: "allow" };
  }

  // An action acceptEdits mode would already allow (a workspace edit) needs no
  // classifier call at all.
  const acceptEditsCheck = checkToolPermission(toolCall, {
    policies: ACCEPT_EDITS_MODE_POLICIES,
  });
  if (acceptEditsCheck.permission === "allow") {
    return { kind: "allow" };
  }

  if (autoModeShouldPrompt()) {
    return { kind: "prompt", reason: t("auto.fallback") };
  }

  let llmApi = autoContext?.llmApi;
  let model = autoContext?.model;
  if (!llmApi || !model) {
    try {
      const modelState = await serviceContainer.get<any>(SERVICE_NAMES.MODEL);
      llmApi = llmApi ?? modelState?.llmApi;
      model = model ?? modelState?.model;
    } catch {
      // No model service: fall through to prompting.
    }
  }
  if (!llmApi || !model) {
    return { kind: "prompt", reason: t("auto.unavailable") };
  }

  let history = autoContext?.history;
  if (!history) {
    try {
      history = services.chatHistory.getHistory();
    } catch {
      history = [];
    }
  }

  const verdict = await classifyAutoAction({
    toolName: toolCall.name,
    toolArgs: toolCall.arguments,
    history: history ?? [],
    actionIndex: history?.length ?? 0,
    llmApi,
    model,
    signal: AbortSignal.timeout(30_000),
  });

  logger.info("Auto mode decision", {
    tool: toolCall.name,
    outcome: verdict.outcome,
    reason: verdict.reason,
  });

  if (verdict.outcome === "allow") return { kind: "allow" };
  if (verdict.outcome === "block") {
    return { kind: "deny", reason: verdict.reason };
  }
  return { kind: "prompt", reason: t("auto.unavailable") };
}

// Helper function to check if tool permission is needed
export async function checkToolPermissionApproval(
  permissions: ToolPermissions,
  toolCall: PreprocessedToolCall,
  callbacks?: StreamCallbacks,
  isHeadless?: boolean,
  /**
   * Ask-path context: `hookAskReason` is set when a PreToolUse hook answered
   * "ask" (escalation outranks the policy), and `autoContext` carries the model
   * used by the auto-mode classifier.
   */
  options?: {
    hookAskReason?: string;
    autoContext?: { llmApi?: any; model?: any; history?: any[] };
  },
): Promise<{
  approved: boolean;
  denialReason?: "user" | "policy";
  message?: string;
}> {
  const hookAskReason = options?.hookAskReason;
  const autoContext = options?.autoContext;
  const permissionCheck = checkToolPermission(toolCall, permissions);

  if (permissionCheck.permission === "allow" && !hookAskReason) {
    return { approved: true };
  } else if (
    permissionCheck.permission === "ask" ||
    (permissionCheck.permission === "allow" && hookAskReason)
  ) {
    const autoActive = services.toolPermissions.getCurrentMode() === "auto";

    if (isHeadless && !autoActive) {
      // "ask" tools are excluded in headless so this is either a policy
      // evaluation that landed on ask or a hook escalation, and with no human
      // to answer either one the call is refused.
      return {
        approved: false,
        denialReason: "policy",
        message: permissionCheck.reason,
      };
    }

    const hookResult = await firePermissionRequest(
      toolCall.name,
      toolCall.arguments,
    );
    const decision = hookResult.permissionRequestDecision;
    if (decision?.behavior === "allow") {
      return { approved: true };
    }
    if (decision?.behavior === "deny") {
      return { approved: false, denialReason: "policy" };
    }
    if (hookResult.blocked) {
      return { approved: false, denialReason: "policy" };
    }

    // Answered once in this session is enough for this exact call; a hook still
    // gets its veto above, and nothing here reaches permissions.yaml.
    if (hasSessionApproval(toolCall.name, toolCall.arguments)) {
      return { approved: true };
    }

    if (autoActive) {
      const autoDecision = await resolveAutoModeDecision(toolCall, autoContext);
      if (autoDecision.kind === "allow") {
        noteAutoSuccess();
        return { approved: true };
      }
      if (autoDecision.kind === "deny") {
        noteAutoDenial();
        return {
          approved: false,
          denialReason: "policy",
          message: t("auto.denied", { reason: autoDecision.reason }),
        };
      }
      // "prompt": the circuit breaker tripped or the classifier was
      // unavailable. Headless has nobody to ask, so it fails closed.
      if (isHeadless) {
        noteAutoDenial();
        return {
          approved: false,
          denialReason: "policy",
          message: t("auto.denied", { reason: autoDecision.reason }),
        };
      }
    }

    // A prompt is about to open; tell notifier hooks (the reference's
    // "permission_prompt" notification type).
    await fireNotification(
      `TNT needs your permission to use ${toolCall.name}`,
      "permission_prompt",
      toolCall.name,
    ).catch(() => {});

    const userApproved = await requestUserPermission(
      toolCall,
      callbacks,
      // The prompt says why it opened: a hook's reason first, else the policy
      // that escalated this particular call rather than the tool in general.
      hookAskReason ?? permissionCheck.reason,
    );
    return userApproved
      ? { approved: true }
      : { approved: false, denialReason: "user" };
  } else if (permissionCheck.permission === "exclude") {
    // Tool blocked by security policy, or by a mode that only reads. The
    // policy reason is passed through when it explains the refusal.
    return {
      approved: false,
      denialReason: "policy",
      message: permissionCheck.reason,
    };
  }

  return { approved: false, denialReason: "policy" };
}

// Helper function to track first token time
