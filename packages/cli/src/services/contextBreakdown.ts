import type { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { getAdjustedTokenCountFromModel } from "core/llm/getAdjustedTokenCount.js";
import { encode } from "gpt-tokenizer";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";

import {
  countToolDefinitionTokens,
  getModelContextLimit,
} from "../utils/tokenizer.js";

export interface ContextCategories {
  systemPrompt: number;
  tools: number;
  conversation: number;
  toolResults: number;
  contextItems: number;
}

export interface ContextBreakdown {
  usedTokens: number;
  contextLimit: number;
  freeTokens: number;
  percentUsed: number;
  categories: ContextCategories;
}

function countContent(content: string | unknown[], modelName: string): number {
  if (typeof content === "string") {
    const raw = encode(content).length;
    return getAdjustedTokenCountFromModel(raw, modelName);
  }
  if (Array.isArray(content)) {
    let sum = 0;
    for (const part of content) {
      const p = part as { type?: string; text?: string };
      if (p.type === "text" && typeof p.text === "string") {
        sum += encode(p.text).length;
      } else if (p.type === "imageUrl" || p.type === "audio") {
        sum += 1024;
      }
    }
    return getAdjustedTokenCountFromModel(sum, modelName);
  }
  return 0;
}

function countToolCallTokens(toolCallFunction?: {
  name?: string;
  arguments?: string;
}): number {
  if (!toolCallFunction) return 0;
  let count = 0;
  if (toolCallFunction.name) {
    count += encode(toolCallFunction.name).length + 10;
  }
  if (toolCallFunction.arguments) {
    count += encode(toolCallFunction.arguments).length;
  }
  return count;
}

function countOutputs(
  output?: Array<{ content?: string; name?: string }>,
): number {
  if (!output || !Array.isArray(output)) return 0;
  let count = 0;
  for (const item of output) {
    if (typeof item.content === "string") {
      count += encode(item.content).length;
    }
    count += 5;
  }
  return count;
}

export function buildContextBreakdown(
  history: ChatHistoryItem[],
  model: ModelConfig,
  tools: ChatCompletionTool[] = [],
): ContextBreakdown {
  const modelName = model.model ?? "";
  const limit = getModelContextLimit(model);

  let systemPrompt = 0;
  let conversation = 0;
  let toolResults = 0;
  let contextItems = 0;

  for (const item of history) {
    const msg = item.message;
    const role = msg.role;

    if (role === "system") {
      systemPrompt += countContent(msg.content, modelName) + 4;
    } else if (role === "user" || role === "assistant") {
      conversation += countContent(msg.content, modelName) + 2;
    } else if (role === "tool") {
      toolResults += countContent(msg.content, modelName) + 5;
    }

    if ("toolCalls" in msg && Array.isArray(msg.toolCalls)) {
      for (const call of msg.toolCalls) {
        toolResults += countToolCallTokens(call.function);
      }
    }

    if (item.contextItems && Array.isArray(item.contextItems)) {
      for (const ctx of item.contextItems) {
        contextItems += encode(ctx.content ?? "").length;
        contextItems += encode(ctx.name ?? "").length;
        contextItems += 5;
      }
    }

    if (item.toolCallStates && Array.isArray(item.toolCallStates)) {
      for (const state of item.toolCallStates) {
        toolResults += countToolCallTokens(state.toolCall?.function);
        toolResults += countOutputs(state.output as Array<{ content?: string }>);
      }
    }
  }

  const toolsTokens = countToolDefinitionTokens(tools);

  const usedTokens =
    systemPrompt + toolsTokens + conversation + toolResults + contextItems;
  const freeTokens = Math.max(0, limit - usedTokens);
  const percentUsed =
    limit > 0 ? Math.min(100, Math.round((usedTokens / limit) * 100)) : 0;

  return {
    usedTokens,
    contextLimit: limit,
    freeTokens,
    percentUsed,
    categories: {
      systemPrompt,
      tools: toolsTokens,
      conversation,
      toolResults,
      contextItems,
    },
  };
}
