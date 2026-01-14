import { describe, expect, it, vi } from "vitest";

import { handleContentDisplay } from "./responseChunks.js";

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
