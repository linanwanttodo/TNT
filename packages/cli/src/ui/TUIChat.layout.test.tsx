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

  it("anchors the first screen and keeps the composer last", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const lines = (lastFrame() ?? "").split("\n");

      // The anchor is one terminal-height block of blank rows (the mock says
      // 12); it pushes the banner and the live frame to the bottom so the
      // composer does not float under a short transcript.
      expect(lines.length).toBeGreaterThan(12);
      expect(lines.slice(0, 12).every((line) => line === "")).toBe(true);

      const content = lines.filter((line) => line.trim() !== "");
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
