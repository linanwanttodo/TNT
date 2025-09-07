/**
 * Convenience functions for firing hook events from integration points.
 *
 * These functions build the hook input with common fields and delegate
 * to the HookService. They are safe to call even if the HookService
 * is not yet initialized (they return no-op results).
 */

import { services } from "../services/index.js";
import { getCurrentSession, getSessionFilePath } from "../session/index.js";

import type {
  ConfigChangeInput,
  HookEventResult,
  NotificationInput,
  PermissionRequestInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreCompactInput,
  PreToolUseInput,
  SessionEndInput,
  SessionEndReason,
  SessionStartInput,
  SessionStartSource,
  SubagentStartInput,
  SubagentStopInput,
  StopInput,
  UserPromptSubmitInput,
} from "./types.js";

const NOOP_RESULT: HookEventResult = { blocked: false, results: [] };

function getCommonFields(): {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
} {
  try {
    const session = getCurrentSession();
    const permissionMode = services.toolPermissions?.isReady()
      ? services.toolPermissions.getState().currentMode
      : undefined;

    return {
      session_id: session.sessionId,
      // The session store is the transcript: a hook that audits what happened
      // reads the same file the resume path writes.
      transcript_path: getSessionFilePath(),
      cwd: process.cwd(),
      permission_mode: permissionMode,
    };
  } catch {
    return {
      session_id: "",
      transcript_path: "",
      cwd: process.cwd(),
    };
  }
}

function isHookServiceReady(): boolean {
  try {
    return services.hooks?.isReady() ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tool events
// ---------------------------------------------------------------------------

export async function firePreToolUse(
  toolName: string,
  toolInput: unknown,
  toolUseId: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: PreToolUseInput = {
    ...getCommonFields(),
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
  };

  return services.hooks.fireEvent(input);
}

export async function firePostToolUse(
  toolName: string,
  toolInput: unknown,
  toolResponse: unknown,
  toolUseId: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: PostToolUseInput = {
    ...getCommonFields(),
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
    tool_use_id: toolUseId,
  };

  return services.hooks.fireEvent(input);
}

export async function firePostToolUseFailure(
  toolName: string,
  toolInput: unknown,
  toolUseId: string,
  error: string,
  isInterrupt?: boolean,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: PostToolUseFailureInput = {
    ...getCommonFields(),
    hook_event_name: "PostToolUseFailure",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
    error,
    is_interrupt: isInterrupt,
  };

  return services.hooks.fireEvent(input);
}

export async function firePermissionRequest(
  toolName: string,
  toolInput: unknown,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: PermissionRequestInput = {
    ...getCommonFields(),
    hook_event_name: "PermissionRequest",
    tool_name: toolName,
    tool_input: toolInput,
  };

  return services.hooks.fireEvent(input);
}

// ---------------------------------------------------------------------------
// Subagent events
// ---------------------------------------------------------------------------

export async function fireSubagentStart(
  agentId: string,
  agentType: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: SubagentStartInput = {
    ...getCommonFields(),
    hook_event_name: "SubagentStart",
    agent_id: agentId,
    agent_type: agentType,
  };

  return services.hooks.fireEvent(input);
}

export async function fireSubagentStop(
  agentId: string,
  agentType: string,
  lastAssistantMessage?: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: SubagentStopInput = {
    ...getCommonFields(),
    hook_event_name: "SubagentStop",
    // A stop is never a continuation here: a blocked Stop does not re-run
    // the agent, so guard-pattern hooks must run on this first event.
    stop_hook_active: false,
    agent_id: agentId,
    agent_transcript_path: "",
    agent_type: agentType,
    last_assistant_message: lastAssistantMessage,
  };

  return services.hooks.fireEvent(input);
}

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

export async function fireUserPromptSubmit(
  prompt: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: UserPromptSubmitInput = {
    ...getCommonFields(),
    hook_event_name: "UserPromptSubmit",
    prompt,
  };

  return services.hooks.fireEvent(input);
}

/**
 * A SessionStart hook writes context for the session, and the session has no
 * message to put it in yet: the chat protocol only carries user and assistant
 * turns. The note is held here and taken by the first prompt of the run, which is
 * where the reference delivers it too.
 */
let pendingSessionContext: string | undefined;

export function takeSessionStartContext(): string | undefined {
  const note = pendingSessionContext;
  pendingSessionContext = undefined;
  return note;
}

export async function fireSessionStart(
  source: SessionStartSource,
  model?: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: SessionStartInput = {
    ...getCommonFields(),
    hook_event_name: "SessionStart",
    source,
    model,
  };

  const result = await services.hooks.fireEvent(input);
  if (result.additionalContext) {
    pendingSessionContext = result.additionalContext;
  }
  return result;
}

export async function fireSessionEnd(
  reason: SessionEndReason,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: SessionEndInput = {
    ...getCommonFields(),
    hook_event_name: "SessionEnd",
    reason,
  };

  return services.hooks.fireEvent(input);
}

export async function fireStop(
  lastAssistantMessage?: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: StopInput = {
    ...getCommonFields(),
    hook_event_name: "Stop",
    // A stop is never a continuation here: a blocked Stop does not re-run
    // the agent, so guard-pattern hooks must run on this first event.
    stop_hook_active: false,
    last_assistant_message: lastAssistantMessage,
  };

  return services.hooks.fireEvent(input);
}

// ---------------------------------------------------------------------------
// Notification event
// ---------------------------------------------------------------------------

export async function fireNotification(
  message: string,
  notificationType: string,
  title?: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: NotificationInput = {
    ...getCommonFields(),
    hook_event_name: "Notification",
    message,
    title,
    notification_type: notificationType,
  };

  return services.hooks.fireEvent(input);
}

// ---------------------------------------------------------------------------
// Compaction event
// ---------------------------------------------------------------------------

export async function firePreCompact(
  trigger: "manual" | "auto",
  customInstructions: string | null = null,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: PreCompactInput = {
    ...getCommonFields(),
    hook_event_name: "PreCompact",
    trigger,
    custom_instructions: customInstructions,
  };

  return services.hooks.fireEvent(input);
}

// ---------------------------------------------------------------------------
// Config change event
// ---------------------------------------------------------------------------

export async function fireConfigChange(
  source: string,
  filePath?: string,
): Promise<HookEventResult> {
  if (!isHookServiceReady()) return NOOP_RESULT;

  const input: ConfigChangeInput = {
    ...getCommonFields(),
    hook_event_name: "ConfigChange",
    source,
    file_path: filePath,
  };

  return services.hooks.fireEvent(input);
}
