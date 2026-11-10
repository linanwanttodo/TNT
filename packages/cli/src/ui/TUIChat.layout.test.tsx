import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";
import { services } from "../services/index.js";

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

  beforeEach(async () => {
    // The shell that runs the suite may export NO_COLOR; the header under
    // test is the colour plate, so ask for it explicitly.
    vi.stubEnv("NO_COLOR", "");
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });
    await services.toolPermissions.doInitialize({ mode: "auto" });
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

      const composerIndex = content.findIndex((line) =>
        line.includes("Ask anything"),
      );
      expect(composerIndex).toBeGreaterThan(-1);
      // The mode rule and the closing rule frame the input without side rails.
      expect(content[composerIndex - 1]).toContain("[Auto]");
      expect(content[composerIndex + 1].replace(/─/g, "").trim()).toBe("");
      expect(content.some((line) => line.includes("│"))).toBe(false);
      // The composer footer carries the transient hint row: always allocated,
      // but idle renders nothing - command discovery lives in the "/" menu,
      // so no "/help" filler appears anywhere, and the trimmed content skips
      // the blank row entirely.
      expect(frame).not.toContain("/help");
      // A single status row follows the composer footer: workspace and model
      // share it. The installed version is not repeated here.
      const status = content[composerIndex + 2];
      expect(status).not.toContain("▸");
      // The banner carries "TNT CLI v<x.y.z>"; pin that, not the bare
      // wordmark - the workspace path in this row can itself contain "TNT"
      // without repeating the version.
      expect(status).not.toContain("TNT CLI v");

      // Nothing follows the status row: it is the bottom of the screen.
      expect(content[content.length - 1]).toBe(status);
    } finally {
      unmount();
    }
  });
});
