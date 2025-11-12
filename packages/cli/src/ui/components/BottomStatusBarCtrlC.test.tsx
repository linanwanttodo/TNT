import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BottomStatusBar,
  BottomStatusBarProps,
  costLineText,
} from "./BottomStatusBar.js";

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

// Each mounted status bar subscribes through the service hooks, so a case that
// leaves it mounted keeps those handlers alive for the rest of the worker.
const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

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
    for (const tree of mounted) tree.unmount();
    mounted.length = 0;
    vi.clearAllMocks();
  });

  it("shows repo URL when not in exit message mode", async () => {
    const indexModule = (await vi.importMock("../../index.js")) as any;
    indexModule.shouldShowExitMessage.mockReturnValue(false);

    const { lastFrame } = track(<BottomStatusBar {...defaultProps} />);

    expect(lastFrame()).toContain("github.com/user/repo");
    expect(lastFrame()).not.toContain("ctrl+c to exit");
  });

  it("shows exit message when shouldShowExitMessage returns true", async () => {
    const indexModule = (await vi.importMock("../../index.js")) as any;
    indexModule.shouldShowExitMessage.mockReturnValue(true);

    const { lastFrame } = track(<BottomStatusBar {...defaultProps} />);

    expect(lastFrame()).toContain("ctrl+c to exit");
    expect(lastFrame()).not.toContain("github.com/user/repo");
  });

  it("registers exit message callback on mount", async () => {
    const indexModule = (await vi.importMock("../../index.js")) as any;

    track(<BottomStatusBar {...defaultProps} />);

    expect(indexModule.setExitMessageCallback).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("shows workspace, branch, context, model and thinking depth in one row", async () => {
    const gitModule = (await vi.importMock("../../utils/git.js")) as any;
    gitModule.isGitRepo.mockReturnValue(true);
    gitModule.getGitBranch.mockReturnValue("feature/status");

    const { lastFrame } = track(
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

    const { lastFrame } = track(
      <BottomStatusBar {...defaultProps} contextPercentage={10} />,
    );

    expect(lastFrame()).toContain("80%");
  });

  it("shows the compaction spend and the cache ratio on their own rows", async () => {
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

    const { lastFrame } = track(
      <BottomStatusBar {...defaultProps} contextPercentage={10} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("80%");
    expect(frame).toContain("$0.3125");
    const rows = frame.split("\n");
    const cacheRow = rows.findIndex((line) => line.includes("80%"));
    const compactionRow = rows.findIndex((line) => line.includes("$0.3125"));
    // They stopped sharing a row when the usage line took one of its own: the
    // cache ratio is a usage figure, the compaction spend stays with location.
    expect(cacheRow).toBeGreaterThan(-1);
    expect(compactionRow).toBeGreaterThan(-1);
    expect(cacheRow).not.toBe(compactionRow);
    expect(compactionRow).toBeLessThan(cacheRow);
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

    const { lastFrame } = track(
      <BottomStatusBar {...defaultProps} contextPercentage={10} />,
    );

    expect(lastFrame()).not.toContain("Compaction");
  });

  it("keeps workspace metadata on the left and the model on the right", async () => {
    const gitModule = (await vi.importMock("../../utils/git.js")) as any;
    gitModule.getGitBranch.mockReturnValue("main");

    const { lastFrame } = track(
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

  it("says how many requests the cost line cannot account for", () => {
    // Asserted as text rather than through a frame: an 80-column test frame
    // truncates before the number of interest.
    expect(costLineText(1.5, 2)).toBe("Cost $1.50 (+2 unpriced)");
    expect(costLineText(0, 1)).toBe("Cost $0.0000 (+1 unpriced)");
    expect(costLineText(1.5, 0)).toBe("Cost $1.50");
    expect(costLineText(0.0042, 0)).toBe("Cost $0.0042");
    expect(costLineText(0, 0)).toBeUndefined();
    expect(costLineText(undefined, 0)).toBeUndefined();
  });

  it("gives the usage line a row of its own", () => {
    const tree = track(
      <BottomStatusBar
        {...defaultProps}
        remoteUrl={"github.com/user/repo"}
        contextPercentage={9}
        totalCost={0.31}
        services={{
          model: { model: { name: "gpt-5", model: "gpt-5" } },
        }}
      />,
    );

    const lines = (tree.lastFrame() ?? "")
      .split("\n")
      .filter((line) => line.trim());
    const usage = lines.find((line) => line.includes("Cost $0.31"));
    expect(usage).toBeDefined();
    expect(usage).toContain("Context 9%");
    // The row holds only usage figures: neither the workspace it used to share a
    // row with nor the model on its right end belongs here.
    expect(usage).not.toContain("▸");
    expect(usage).not.toContain("◈");
    expect(usage).not.toContain("gpt-5");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
