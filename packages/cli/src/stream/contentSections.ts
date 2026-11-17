import type { ChatHistoryItem } from "core/index.js";
import type { ChatCompletionTool } from "openai/resources.mjs";

import { splitServedPrompt } from "../utils/promptNotes.js";
import { countToolDefinitionTokens } from "../utils/tokenizer.js";

/**
 * A coarse, local-only split of one request's input by content class. Qoder
 * bills seven classes; TNT does not have per-part accounting from providers,
 * so these are estimates from the request we assembled, not provider numbers.
 * The point is a per-round trend: a growing `tools` or `hookNotes` share says
 * where the next optimization has to land.
 */

export interface ContentSections {
  system: number;
  tools: number;
  messages: number;
  hookNotes: number;
}

export function emptyContentSections(): ContentSections {
  return { system: 0, tools: 0, messages: 0, hookNotes: 0 };
}

/** chars/4: a gate does not need tokenizer precision. */
function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageText(item: ChatHistoryItem): string {
  const content = item.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  return "";
}

export function estimateContentSections(options: {
  systemMessage: string;
  systemMessageUpdates?: readonly string[];
  tools?: ChatCompletionTool[];
  chatHistory: readonly ChatHistoryItem[];
  environmentContext?: string;
}): ContentSections {
  const sections = emptyContentSections();
  const updates = options.systemMessageUpdates ?? [];
  sections.system = estimate([options.systemMessage, ...updates].join("\n"));
  sections.tools = countToolDefinitionTokens(options.tools ?? []);
  sections.hookNotes = estimate(options.environmentContext ?? "");
  for (const item of options.chatHistory) {
    const text = messageText(item);
    const split = splitServedPrompt(text);
    sections.messages += estimate(split.userText);
    sections.hookNotes += estimate(split.notes.join("\n"));
  }
  return sections;
}

/** Add one round into a running turn's sections. */
export function addContentSections(
  target: ContentSections,
  addition: ContentSections,
): ContentSections {
  return {
    system: target.system + addition.system,
    tools: target.tools + addition.tools,
    messages: target.messages + addition.messages,
    hookNotes: target.hookNotes + addition.hookNotes,
  };
}
