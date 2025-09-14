import { render } from "ink-testing-library";
import React from "react";

import { setLocale } from "../i18n/index.js";
import { waitForCondition } from "../test-utils/TUIChat.testHelper.js";
import { createUITestContext } from "../test-utils/ui-test-context.js";

import { AppRoot } from "./AppRoot.js";

describe("TUIChat - Basic UI Tests", () => {
  let context: any;

  beforeEach(() => {
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });
  });

  afterEach(() => {
    context.cleanup();
    setLocale("en");
  });

  it("renders without crashing", () => {
    const { lastFrame } = render(React.createElement(AppRoot));
    const frame = lastFrame();

    expect(frame).toBeDefined();
    if (frame) {
      expect(frame.length).toBeGreaterThan(0);
    }
  });

  it("shows UI even when services are loading", () => {
    // Override for this test
    context.mockUseServices.mockReturnValue({
      services: {},
      loading: true,
      error: null,
      allReady: false,
    });

    const { lastFrame } = render(React.createElement(AppRoot));
    const frame = lastFrame();

    expect(frame).toBeDefined();
    if (frame) {
      // Should show the chat UI even while loading
      expect(frame).toContain("Ask anything");
    }
  });

  it("handles remote URL prop", () => {
    const { lastFrame } = render(
      React.createElement(AppRoot, { remoteUrl: "http://localhost:3000" }),
    );
    const frame = lastFrame();

    expect(frame).toBeDefined();
    if (frame) {
      expect(frame.length).toBeGreaterThan(0);
    }
  });

  it("localizes the composer and status labels after /language", async () => {
    setLocale("zh-CN");
    const { lastFrame } = render(React.createElement(AppRoot));

    await waitForCondition(() => lastFrame()?.includes("输入内容") ?? false);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("上下文");
    expect(frame).not.toContain("Ask anything");
  });
});
