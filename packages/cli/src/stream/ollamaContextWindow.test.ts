import { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyOllamaContextWindow } from "../config/index.js";
import { ContextBudgetTracker } from "../loop/contextBudget.js";

import { pruneHistoryToContextLimit } from "./requestPreparation.js";

const showResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response;

function ollamaModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    name: "local",
    model: "qwen3:8b",
    provider: "ollama",
    apiBase: "http://localhost:11434",
    ...overrides,
  } as ModelConfig;
}

function userItem(text: string): ChatHistoryItem {
  return {
    message: { role: "user", content: text },
    contextItems: [],
  } as ChatHistoryItem;
}

/** Messages of real words, roughly `tokens` tokens each (about 1 per word). */
function historyOfTokens(tokens: number): ChatHistoryItem[] {
  const words =
    "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ";
  const perMessage = 2_000;
  const count = Math.ceil(tokens / perMessage);
  return Array.from({ length: count }, (_, index) =>
    userItem(`message ${index}: ${words.repeat(Math.ceil(perMessage / 12))}`),
  );
}

describe("applyOllamaContextWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills contextLength from the server's num_ctx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => showResponse({ model_info: { num_ctx: 16384 } })),
    );
    const model = ollamaModel();

    const filled = await applyOllamaContextWindow(model);

    expect(filled.contextLength).toBe(16384);
  });

  it("leaves an explicitly configured window alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const model = ollamaModel({ contextLength: 32768 });

    const filled = await applyOllamaContextWindow(model);

    expect(filled.contextLength).toBe(32768);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves every non-ollama provider untouched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const model = ollamaModel({ provider: "lmstudio" });

    const filled = await applyOllamaContextWindow(model);

    expect(filled.contextLength).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the model unchanged when the probe fails, for the 8192 floor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const model = ollamaModel();

    const filled = await applyOllamaContextWindow(model);

    expect(filled.contextLength).toBeUndefined();
  });
});

/**
 * The point of the discovered window: pruning and the budget notice must
 * divide by what the local model actually has, not by the 200k a config
 * without a contextLength used to inherit.
 */
describe("context budgeting on the discovered window", () => {
  it("prunes against the real window, which the 200k cloud default would not", () => {
    // ~20k tokens of history: past a 16384-token window once the output
    // reservation is subtracted, comfortably inside a cloud model's 200k.
    const history = historyOfTokens(20_000);
    const discovered = ollamaModel({ contextLength: 16384 });
    const cloud = ollamaModel({ provider: "openai", model: "gpt-4" });

    const pruned = pruneHistoryToContextLimit({
      chatHistory: history,
      model: discovered,
      systemMessage: "",
      systemMessageUpdates: [],
    });
    const onCloudDefault = pruneHistoryToContextLimit({
      chatHistory: history,
      model: cloud,
      systemMessage: "",
      systemMessageUpdates: [],
    });

    expect(pruned.chatHistory.length).toBeLessThan(history.length);
    expect(onCloudDefault.chatHistory.length).toBe(history.length);
  });

  it("keeps the 8192 floor for an ollama model the probe could not read", () => {
    const history = historyOfTokens(20_000);

    const pruned = pruneHistoryToContextLimit({
      chatHistory: history,
      model: ollamaModel(),
      systemMessage: "",
      systemMessageUpdates: [],
    });

    expect(pruned.chatHistory.length).toBeLessThan(history.length);
  });

  it("raises the budget reminder on the real window and not on 200k", () => {
    const tracker = new ContextBudgetTracker();
    tracker.recordRequest(15_000);

    expect(tracker.reminder(16384)).toBeDefined();
    expect(tracker.reminder(200_000)).toBeUndefined();
  });
});
