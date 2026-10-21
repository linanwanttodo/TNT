import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";

import { AppRoot } from "./AppRoot.js";

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30, isResizing: false }),
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

  it("pins the composer to the bottom of a fixed viewport", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");
      const content = lines.filter((line) => line.trim() !== "");

      // The viewport is the terminal height, not a transcript-height block
      // followed by a screen of blank rows.
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(content.length).toBeGreaterThanOrEqual(5);

      // The banner/transcript comes first; the composer is the last block.
      expect(frame.indexOf("Ask anything")).toBeGreaterThan(0);

      const composer = content.slice(-5);
      expect(composer[0]).toContain("╭");
      expect(composer[1]).toContain("Ask anything");
      expect(composer[2]).toContain("╰");
      expect(composer[3]).toContain("TNT");
      expect(composer[4]).toContain("Context");

      // Nothing follows the usage line: it is the bottom of the screen.
      expect(lines[lines.length - 1]).toContain("Context");
    } finally {
      unmount();
    }
  });
});
