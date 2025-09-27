import type { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { compactChatHistory } from "./index.js";

const model = {
  provider: "test",
  model: "test-model",
  defaultCompletionOptions: { contextLength: 1000, maxTokens: 200 },
} as unknown as ModelConfig;

// 400 words is over the retain budget of a 1,000-token window, so the history has
// to be summarized rather than merely split.
const history: ChatHistoryItem[] = [
  {
    message: { role: "user", content: `${"word ".repeat(400)}\n` },
    contextItems: [],
  },
  { message: { role: "assistant", content: "acknowledged" }, contextItems: [] },
];

describe("the summarizer a compaction runs on", () => {
  it("writes the summary with the function it was given", async () => {
    const result = await compactChatHistory(history, model, {} as never, {
      summarize: async ({ callbacks }) => {
        callbacks.onContent("the summary");
        callbacks.onContentComplete();
        return "the summary";
      },
    });

    expect(result.compactionContent).toBe("the summary");
  });

  it("refuses when nobody gave it a way to summarize", async () => {
    // Before this seam the module reached up into the stream engine for that
    // function, which is how the two groups came to import each other and why a
    // compaction unit test had to boot the service container to run at all.
    await expect(
      compactChatHistory(history, model, {} as never, {}),
    ).rejects.toThrow(/no summarizer/);
  });
});
