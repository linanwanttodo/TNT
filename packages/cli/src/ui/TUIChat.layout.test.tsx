import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";

import { AppRoot } from "./AppRoot.js";

// The header is an intro element; force it on so the first screen is the
// screen under test.
vi.mock("./hooks/useTUIChatHooks.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIntroMessage: () => [true, vi.fn()] as const,
}));

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30, isResizing: false }),
}));

describe("TUIChat layout", () => {
  let context: ReturnType<typeof createUITestContext>;

  beforeEach(() => {
    // The shell that runs the suite may export NO_COLOR; the header under
    // test is the colour plate, so ask for it explicitly.
    vi.stubEnv("NO_COLOR", "");
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    context.cleanup();
  });

  it("puts the header at the top of the frame, above the composer", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const lines = (lastFrame() ?? "").split("\n");
      const firstContent = lines.findIndex((line) => line.trim() !== "");
      const composerIndex = lines.findIndex((line) =>
        line.includes("Ask anything"),
      );
      const logoIndex = lines.findIndex((line) => line.includes("███████"));

      expect(logoIndex).toBeGreaterThan(-1);
      // Top-left: the header is the first thing on screen and starts at the
      // left margin, far above the composer.
      expect(logoIndex).toBe(firstContent);
      // Top-left of the screen, not the last block above the composer.
      expect(logoIndex).toBeLessThanOrEqual(2);
      expect(lines[logoIndex].search(/█/)).toBeLessThanOrEqual(2);
      expect(composerIndex).toBeGreaterThan(logoIndex + 2);
    } finally {
      unmount();
    }
  });

  it("fills the alternate screen and pins the dock to the bottom", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");
      const content = lines.filter((line) => line.trim() !== "");

      // The app owns the whole screen, so the frame is the terminal's height.
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(lines.length).toBeGreaterThanOrEqual(28);
      expect(content.length).toBeGreaterThanOrEqual(5);

      // The banner/transcript comes first; the composer is the last block.
      expect(frame.indexOf("Ask anything")).toBeGreaterThan(0);

      const composerBorder = content.findIndex((line) => line.includes("╭"));
      expect(composerBorder).toBeGreaterThan(-1);
      expect(content[composerBorder + 1]).toContain("Ask anything");
      expect(content[composerBorder + 2]).toContain("╰");
      // A single status row follows the composer: model and usage share it.
      const status = content[composerBorder + 3];
      expect(status).toContain("TNT");
      expect(status).toContain("Context");

      // Nothing follows the usage line: it is the bottom of the screen.
      expect(content[content.length - 1]).toContain("Context");
    } finally {
      unmount();
    }
  });
});
