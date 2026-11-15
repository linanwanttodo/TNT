import type { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import type { MeasuredRequest } from "./measuredContext.js";

import { shouldAutoCompact } from "./index.js";

const model = {
  provider: "test",
  model: "test-model",
  defaultCompletionOptions: { contextLength: 10_000, maxTokens: 1_000 },
} as unknown as ModelConfig;

// The window is 10,000 with 1,000 reserved, so the compact threshold sits near
// 7,200 tokens. This history is well above it, so a local count must decide to
// compact and the measurement is the only thing that can say otherwise.
const huge = `${"many words ".repeat(5000)}\n`;

function history(content: string): ChatHistoryItem[] {
  return [
    { message: { role: "user", content }, contextItems: [] },
    {
      message: { role: "assistant", content: "acknowledged" },
      contextItems: [],
    },
  ];
}

const measured: MeasuredRequest = {
  promptTokens: 200,
  historyLength: 2,
  prefixKey: "prefix-a",
};

describe("shouldAutoCompact against a measured request", () => {
  it("counts the whole history when nothing has been measured", () => {
    expect(shouldAutoCompact({ chatHistory: history(huge), model })).toBe(true);
  });

  it("trusts what the provider measured instead of counting it again", () => {
    // The history is the same as above and still enormous to a local count, but
    // the provider reported 200 input tokens for exactly this request.
    expect(
      shouldAutoCompact({
        chatHistory: history(huge),
        model,
        measured,
        prefixKey: "prefix-a",
      }),
    ).toBe(false);
  });

  it("counts the whole history when the cache prefix has moved", () => {
    expect(
      shouldAutoCompact({
        chatHistory: history(huge),
        model,
        measured,
        prefixKey: "prefix-b",
      }),
    ).toBe(true);
  });
});
