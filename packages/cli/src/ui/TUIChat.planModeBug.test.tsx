import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";
import { services } from "../services/index.js";

import { AppRoot } from "./AppRoot.js";
const toolPermissionService = services.toolPermissions;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens the Shift+Tab menu and switches from one mode index to another. */
const switchTo = async (
  stdin: { write: (data: string) => void },
  from: number,
  to: number,
) => {
  stdin.write("\x1b[Z"); // Shift+Tab opens the menu on the current mode
  await sleep(150);
  const steps = (to - from + 5) % 5;
  for (let i = 0; i < steps; i += 1) {
    stdin.write("\x1b[B"); // down
  }
  await sleep(80);
  stdin.write("\r"); // select
  await sleep(200);
};

// The menu order shared with ModeMenu: default, acceptEdits, plan, auto,
// bypassPermissions.
describe("TUIChat - plan mode via the mode menu", () => {
  let context: any;

  beforeEach(async () => {
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });

    // Ensure mode service is properly initialized in normal mode
    await toolPermissionService.doInitialize({
      mode: "default",
    });
  });

  afterEach(() => {
    context.cleanup();
  });

  it("a) start up b) menu to plan c) [Plan] visible d) send message", async () => {
    const { lastFrame, stdin, unmount } = render(React.createElement(AppRoot));

    try {
      // a) Start up
      let frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame).toContain("Ask anything");

      // b) Shift+Tab opens the menu; plan is two rows down from Manual
      await switchTo(stdin, 0, 2);

      frame = lastFrame();

      // c) Make sure the string "[Plan]" is on the screen
      expect(frame!).toContain("Plan]");
      // The mode label is embedded in the composer's top border line.
      expect(frame!).toMatch(/╭─\[Plan\]/);

      // d) Successfully send a message without error
      const testMessage = "Can you help me analyze this code?";
      stdin.write(testMessage);
      stdin.write("\r");

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      frame = lastFrame();

      // Verify no crash occurred and UI is still functional
      expect(frame).toBeDefined();
      expect(frame!.length).toBeGreaterThan(0);

      // Should still be in plan mode after sending message
      expect(frame!).toContain("Plan]");

      // Should still show the input prompt
      expect(frame!).toContain("Ask anything");
    } finally {
      unmount();
    }
  });

  it("tests mode switching back and forth works correctly", async () => {
    const { lastFrame, stdin, unmount } = render(React.createElement(AppRoot));

    try {
      // Start in default mode
      let frame = lastFrame();
      expect(frame!).not.toContain("Plan]");
      expect(frame!).not.toContain("Accept edits]");

      // Switch to acceptEdits
      await switchTo(stdin, 0, 1);

      frame = lastFrame();
      expect(frame!).toContain("Accept edits]");

      // Switch to plan
      await switchTo(stdin, 1, 2);

      frame = lastFrame();
      expect(frame!).toContain("Plan]");
      expect(frame!).not.toContain("Accept edits]");

      // Switch back to default
      await switchTo(stdin, 2, 0);

      frame = lastFrame();
      expect(frame!).not.toContain("Plan]");
      expect(frame!).not.toContain("Accept edits]");
    } finally {
      unmount();
    }
  });

  it("tests that you can switch modes after being in plan mode", async () => {
    const { lastFrame, stdin, unmount } = render(React.createElement(AppRoot));

    try {
      // Menu to plan
      await switchTo(stdin, 0, 2);

      let frame = lastFrame();
      expect(frame!).toContain("Plan]");

      // Send a message while in plan mode
      stdin.write("Test message");
      stdin.write("\r");
      await new Promise((resolve) => setTimeout(resolve, 200));

      frame = lastFrame();

      // Try to switch after a message - this is where the bug might occur
      await switchTo(stdin, 2, 0);

      frame = lastFrame();

      // This should work - if it fails, we've reproduced the "can't switch back" bug
      expect(frame!).not.toContain("Plan]");
    } finally {
      unmount();
    }
  });
});
