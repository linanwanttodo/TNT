import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BottomStatusBar,
  BottomStatusBarProps,
} from "../components/BottomStatusBar.js";

// Mock the index module functions
vi.mock("../../index.js", () => ({
  shouldShowExitMessage: vi.fn(() => false),
  setExitMessageCallback: vi.fn(),
}));

// Mock git utility functions
vi.mock("../../utils/git.js", () => ({
  isGitRepo: vi.fn(() => false),
  getGitRemoteUrl: vi.fn(() => null),
  getGitBranch: vi.fn(() => null),
}));

vi.mock("../../session/index.js", () => ({
  getSessionUsage: vi.fn(() => undefined),
}));

describe("BottomStatusBar Ctrl+C message", () => {
  const defaultProps: BottomStatusBarProps = {
    remoteUrl: "github.com/user/repo",
    isRemoteMode: false,
    services: { model: { model: null } },
    navState: { currentScreen: "chat" },
    navigateTo: vi.fn(),
    closeCurrentScreen: vi.fn(),
    contextPercentage: undefined,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mocks to default state
    const indexModule = (await vi.importMock("../../index.js")) as any;
    indexModule.shouldShowExitMessage.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows repo URL when not in exit message mode", async () => {
    const indexModule = (await vi.importMock("../../index.js")) as any;
    indexModule.shouldShowExitMessage.mockReturnValue(false);

    const { lastFrame } = render(<BottomStatusBar {...defaultProps} />);

    expect(lastFrame()).toContain("github.com/user/repo");
    expect(lastFrame()).not.toContain("ctrl+c to exit");
  });

  it("shows exit message when shouldShowExitMessage returns true", async () => {
    const indexModule = (await vi.importMock("../../index.js")) as any;
    indexModule.shouldShowExitMessage.mockReturnValue(true);

    const { lastFrame } = render(<BottomStatusBar {...defaultProps} />);

    expect(lastFrame()).toContain("ctrl+c to exit");
    expect(lastFrame()).not.toContain("github.com/user/repo");
  });

  it("registers exit message callback on mount", async () => {
    const indexModule = (await vi.importMock("../../index.js")) as any;

    render(<BottomStatusBar {...defaultProps} />);

    expect(indexModule.setExitMessageCallback).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("shows workspace, branch, context, model and thinking depth in one row", async () => {
    const gitModule = (await vi.importMock("../../utils/git.js")) as any;
    gitModule.isGitRepo.mockReturnValue(true);
    gitModule.getGitBranch.mockReturnValue("feature/status");

    const { lastFrame } = render(
      <BottomStatusBar
        {...defaultProps}
        remoteUrl={undefined}
        contextPercentage={34}
        services={{
          model: {
            model: {
              name: "deepseek/deepseek-chat",
              model: "deepseek-chat",
              defaultCompletionOptions: { reasoningEffort: "high" },
            },
          },
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain(process.cwd().split(/[\\/]/).pop() ?? "");
    expect(frame).toContain("feature/status");
    expect(frame).toContain("deepseek/deepseek-chat");
    expect(frame).toContain("think:high");
    expect(frame).toContain("34%");
    expect(frame.indexOf("deepseek/deepseek-chat")).toBeLessThan(
      frame.indexOf("think:high"),
    );
  });

  it("shows the cache hit ratio when the session reported cache tokens", async () => {
    const sessionModule = (await vi.importMock(
      "../../session/index.js",
    )) as any;
    sessionModule.getSessionUsage.mockReturnValue({
      totalCost: 0,
      promptTokens: 1000,
      completionTokens: 0,
      promptTokensDetails: { cachedTokens: 800, cacheWriteTokens: 0 },
    });

    const { lastFrame } = render(
      <BottomStatusBar {...defaultProps} contextPercentage={10} />,
    );

    expect(lastFrame()).toContain("80%");
  });

  it("shows the compaction spend next to the cache hit ratio", async () => {
    const sessionModule = (await vi.importMock(
      "../../session/index.js",
    )) as any;
    sessionModule.getSessionUsage.mockReturnValue({
      totalCost: 1.5,
      promptTokens: 10000,
      completionTokens: 0,
      promptTokensDetails: { cachedTokens: 8000, cacheWriteTokens: 0 },
      compaction: {
        requests: 2,
        inputTokens: 24000,
        outputTokens: 1000,
        cachedTokens: 12000,
        cacheWriteTokens: 0,
        cost: 0.3125,
      },
    });

    const { lastFrame } = render(
      <BottomStatusBar {...defaultProps} contextPercentage={10} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("80%");
    expect(frame).toContain("$0.3125");
    expect(frame.indexOf("80%")).toBeLessThan(frame.indexOf("$0.3125"));
  });

  it("hides the compaction spend before any compaction ran", async () => {
    const sessionModule = (await vi.importMock(
      "../../session/index.js",
    )) as any;
    sessionModule.getSessionUsage.mockReturnValue({
      totalCost: 0,
      promptTokens: 1000,
      completionTokens: 0,
      promptTokensDetails: { cachedTokens: 800, cacheWriteTokens: 0 },
    });

    const { lastFrame } = render(
      <BottomStatusBar {...defaultProps} contextPercentage={10} />,
    );

    expect(lastFrame()).not.toContain("Compaction");
  });

  it("keeps workspace metadata on the left and the model on the right", async () => {
    const gitModule = (await vi.importMock("../../utils/git.js")) as any;
    gitModule.getGitBranch.mockReturnValue("main");

    const { lastFrame } = render(
      <BottomStatusBar
        {...defaultProps}
        remoteUrl={undefined}
        contextPercentage={5}
        services={{
          model: { model: { name: "gpt-5", model: "gpt-5" } },
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    const workspaceIndex = frame.indexOf("main");
    const modelIndex = frame.indexOf("gpt-5");
    expect(workspaceIndex).toBeGreaterThanOrEqual(0);
    expect(modelIndex).toBeGreaterThan(workspaceIndex);
  });
});
