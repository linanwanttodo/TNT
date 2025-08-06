import { ModelDescription, Tool } from "core";
import {
  DEFAULT_AGENT_SYSTEM_MESSAGE,
  DEFAULT_CHAT_SYSTEM_MESSAGE,
  DEFAULT_DEBUG_SYSTEM_MESSAGE,
  DEFAULT_MULTITASK_SYSTEM_MESSAGE,
  DEFAULT_PLAN_SYSTEM_MESSAGE,
} from "core/llm/defaultSystemMessages";

export const NO_TOOL_WARNING =
  "\n\nTHE USER HAS NOT PROVIDED ANY TOOLS, DO NOT ATTEMPT TO USE ANY TOOLS. STOP AND LET THE USER KNOW THAT THERE ARE NO TOOLS AVAILABLE. The user can provide tools by enabling them in the Tool Policies section of the notch (wrench icon)";

export function getBaseSystemMessage(
  messageMode: string,
  model: ModelDescription,
  activeTools?: Tool[],
): string {
  let baseMessage: string;

  if (messageMode === "agent") {
    baseMessage = model.baseAgentSystemMessage ?? DEFAULT_AGENT_SYSTEM_MESSAGE;
  } else if (messageMode === "plan") {
    baseMessage = model.basePlanSystemMessage ?? DEFAULT_PLAN_SYSTEM_MESSAGE;
  } else if (messageMode === "debug") {
    baseMessage = model.baseDebugSystemMessage ?? DEFAULT_DEBUG_SYSTEM_MESSAGE;
  } else if (messageMode === "multitask") {
    baseMessage =
      model.baseMultitaskSystemMessage ?? DEFAULT_MULTITASK_SYSTEM_MESSAGE;
  } else {
    baseMessage = model.baseChatSystemMessage ?? DEFAULT_CHAT_SYSTEM_MESSAGE;
  }

  // Every mode now runs on at least the read-only tools, so an empty set
  // means the user disabled everything and the model should say so rather
  // than silently answering without them.
  if (!activeTools || activeTools.length === 0) {
    baseMessage += NO_TOOL_WARNING;
  }

  return baseMessage;
}
