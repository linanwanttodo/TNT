import { describe, expect, it, vi } from "vitest";

import { handleContentDisplay, processChunk } from "./responseChunks.js";

describe("processChunk", () => {
  it("forwards a provider's reasoning_content to onReasoning", () => {
    const onReasoning = vi.fn();

    const result = processChunk({
      chunk: {
        choices: [{ delta: { reasoning_content: "weighing the options" } }],
      },
      aiResponse: "",
      toolCallsMap: new Map(),
      indexToIdMap: new Map(),
      callbacks: { onReasoning },
    });

    expect(onReasoning).toHaveBeenCalledWith("weighing the options");
    expect(result.reasoningDelta).toBe("weighing the options");
    expect(result.aiResponse).toBe("");
  });
});

describe("handleContentDisplay", () => {
  it("announces the end of the round's reasoning even with no content", () => {
    const onReasoningComplete = vi.fn();
    const onContentComplete = vi.fn();

    handleContentDisplay("", { onReasoningComplete, onContentComplete }, false);

    expect(onReasoningComplete).toHaveBeenCalledTimes(1);
    expect(onContentComplete).not.toHaveBeenCalled();
  });

  it("still reports finished content", () => {
    const onContentComplete = vi.fn();

    handleContentDisplay("answer", { onContentComplete }, false);

    expect(onContentComplete).toHaveBeenCalledWith("answer");
  });
});
