import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../test-utils/ui-test-context.js";
import { AppRoot } from "./AppRoot.js";

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 12, isResizing: false }),
}));

describe("TUIChat layout", () => {
  let context: ReturnType<typeof createUITestContext>;

  beforeEach(() => {
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });
  });

  afterEach(() => context.cleanup());

  it("sizes the frame to its content and keeps the composer last", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const lines = (lastFrame() ?? "").split("\n");
      const lastLine = lines.length - 1;

      // No blank rows are inserted to fill the terminal: the frame is only as
      // tall as the composer and the status bar, so everything the transcript
      // prints above it stays on screen.
      expect(lines).toHaveLength(4);
      expect(lines.filter((line) => line.trim() === "")).toHaveLength(0);

      expect(lines[lastLine]).toContain("TNT");
      expect(lines[lastLine - 1]).toContain("╰");
      expect(lines[lastLine - 2]).toContain("Ask anything");
      expect(lines[lastLine - 3]).toContain("╭");
    } finally {
      unmount();
    }
  });
});
