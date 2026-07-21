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
      // Top-left: the bare wordmark is the first thing on screen, far above
      // the composer.
      expect(logoIndex).toBe(firstContent);
      expect(logoIndex).toBeLessThanOrEqual(2);
      expect(lines[logoIndex].search(/█/)).toBeLessThanOrEqual(2);
      expect(composerIndex).toBeGreaterThan(logoIndex + 2);
    } finally {
      unmount();
    }
  });

  it("keeps the dock together in the normal buffer", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");
      const content = lines.filter((line) => line.trim() !== "");

      // The normal buffer hands settled transcript rows to the terminal's
      // scrollback through <Static>; the frame is not pinned to the terminal
      // height any more, so scrolling and native selection are the terminal's.
      expect(content.length).toBeGreaterThanOrEqual(5);

      // The banner/transcript comes first; the composer stays together.
      expect(frame.indexOf("Ask anything")).toBeGreaterThan(0);

      const composerIndex = content.findIndex((line) =>
        line.includes("Ask anything"),
      );
      expect(composerIndex).toBeGreaterThan(-1);
      // The gemini-style box has no rule lines; the footer row below it
      // carries the mode and the working directory.
      expect(frame).not.toContain("[Auto]");
      const footer = content[composerIndex + 1];
      expect(footer).toContain("Auto");
      // No frame and no side rails anywhere in the composer.
      expect(content.some((line) => line.includes("│"))).toBe(false);
      // The dock itself carries no "/help" filler row; command discovery
      // lives in the "/" menu. The greeting inside the welcome frame is the
      // only place the word appears.
      expect(footer).not.toContain("/help");
      expect(content.slice(content.indexOf(footer)).join("")).not.toContain(
        "/help",
      );
      // The footer is a single row: mode, directory, model and reasoning
      // depth share it, with no separate status row below.
      expect(footer).not.toContain("▸");
      // The banner carries "TNT CLI v<x.y.z>"; pin that, not the bare
      // wordmark - the workspace path in this row can itself contain "TNT"
      // without repeating the version.
      expect(footer).not.toContain("TNT CLI v");

      // Nothing follows the footer: it is the bottom of the screen.
      expect(content[content.length - 1]).toBe(footer);
    } finally {
      unmount();
    }
  });
});
