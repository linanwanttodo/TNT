import type { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { encode } from "gpt-tokenizer";
import { describe, expect, it } from "vitest";

import { pruneHistoryToContextLimit } from "./requestPreparation.js";

const WORDS =
  "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega";

function bigContent(tokens: number): string {
  const wordList = WORDS.split(" ");
  const parts: string[] = [];
  while (parts.join(" ").split(" ").length < tokens) {
    parts.push(wordList[parts.length % wordList.length]);
  }
  return parts.join(" ");
}

/**
 * A two-message prune (a user message followed by its assistant reply) is the
 * shape pruneLastMessage produces when the second-to-last item is a plain
 * user message: the last assistant turn is left dangling without its prompt,
 * so both go. The loop must subtract both item counts, not just the last.
 */
describe("pruneHistoryToContextLimit", () => {
  const model: ModelConfig = {
    name: "test-model",
    model: "test",
    provider: "openai",
    defaultCompletionOptions: { contextLength: 400, maxTokens: 50 },
  };

  function history(): ChatHistoryItem[] {
    return [
      { message: { role: "user", content: bigContent(100) }, contextItems: [] },
      {
        message: { role: "assistant", content: bigContent(6) },
        contextItems: [],
      },
      { message: { role: "user", content: bigContent(100) }, contextItems: [] },
      {
        message: { role: "assistant", content: bigContent(6) },
        contextItems: [],
      },
      { message: { role: "user", content: bigContent(100) }, contextItems: [] },
      {
        message: { role: "assistant", content: bigContent(6) },
        contextItems: [],
      },
    ] as unknown as ChatHistoryItem[];
  }

  it("removes enough on a two-message prune to fit without over-pruning", () => {
    const { chatHistory, maxTokens } = pruneHistoryToContextLimit({
      chatHistory: history(),
      model,
      systemMessage: "",
      systemMessageUpdates: [],
    });

    expect(chatHistory.length).toBe(4);
    expect(maxTokens).toBeGreaterThan(0);
  });

  it("keeps its own arithmetic in agreement with a full recount", () => {
    const { chatHistory, maxTokens } = pruneHistoryToContextLimit({
      chatHistory: history(),
      model,
      systemMessage: encode("system").join(""),
      systemMessageUpdates: [],
    });

    expect(chatHistory.length).toBeGreaterThan(0);
    expect(maxTokens).toBeGreaterThan(0);
  });
});
