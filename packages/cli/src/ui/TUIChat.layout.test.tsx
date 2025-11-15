import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";

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
      // tall as the composer and the two status rows, so everything the
      // transcript prints above them stays on screen.
      expect(lines).toHaveLength(5);
      expect(lines.filter((line) => line.trim() === "")).toHaveLength(0);

      // The usage line is the bottom of the screen, and it is alone there.
      expect(lines[lastLine]).toContain("Context");
      expect(lines[lastLine]).not.toContain("╰");
      expect(lines[lastLine - 1]).toContain("TNT");
      expect(lines[lastLine - 2]).toContain("╰");
      expect(lines[lastLine - 3]).toContain("Ask anything");
      expect(lines[lastLine - 4]).toContain("╭");
    } finally {
      unmount();
    }
  });
});
