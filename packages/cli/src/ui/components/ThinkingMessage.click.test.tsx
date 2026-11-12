import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { resetReasoningFold } from "../reasoningFold.js";
import { dispatchClick } from "../utils/clickRegions.js";

import { ThinkingMessage } from "./ThinkingMessage.js";

describe("folded thinking block", () => {
  it("expands on a click when the app owns the mouse", async () => {
    resetReasoningFold();
    const tree = render(<ThinkingMessage thought="consider the cache line" />);
    try {
      const folded = tree.lastFrame() ?? "";
      expect(folded).not.toContain("consider the cache line");

      // The block occupies the first row of the frame; a left click there
      // toggles the fold through the click region.
      expect(dispatchClick(1, 3)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const expanded = tree.lastFrame() ?? "";
      expect(expanded).toContain("consider the cache line");
    } finally {
      tree.unmount();
    }
  });
});
