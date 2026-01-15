import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTerminalSize } from "../hooks/useTerminalSize.js";

import { BottomStatusBar } from "./BottomStatusBar.js";

vi.mock("../../index.js", () => ({
  shouldShowExitMessage: vi.fn(() => false),
  setExitMessageCallback: vi.fn(),
}));

vi.mock("../../utils/git.js", () => ({
  isGitRepo: vi.fn(() => true),
  getGitRemoteUrl: vi.fn(() => null),
  getGitBranch: vi.fn(() => "feature/a-long-branch-name"),
}));

vi.mock("../../session/index.js", () => ({
  getSessionUsage: vi.fn(() => ({
    totalCost: 0.42,
    promptTokens: 20000,
    completionTokens: 1200,
    promptTokensDetails: { cachedTokens: 18000 },
  })),
}));

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: vi.fn(() => ({
    columns: 60,
    rows: 20,
    isResizing: false,
  })),
}));

const mounted: { unmount: () => void }[] = [];

afterEach(() => {
  for (const tree of mounted) tree.unmount();
  mounted.length = 0;
  vi.mocked(useTerminalSize).mockReturnValue({
    columns: 60,
    rows: 20,
    isResizing: false,
  });
});

describe("BottomStatusBar width", () => {
  it("does not add a clipboard paste hint", () => {
    vi.mocked(useTerminalSize).mockReturnValue({
      columns: 200,
      rows: 20,
      isResizing: false,
    });
    const tree = render(
      <BottomStatusBar
        remoteUrl="github.com/example/repo"
        isRemoteMode={false}
        services={{
          model: {
            model: {
              name: "test-model",
              defaultCompletionOptions: { contextLength: 200000 },
            },
          },
        }}
        navState={{ currentScreen: "chat" }}
        navigateTo={vi.fn()}
        closeCurrentScreen={vi.fn()}
        isVerboseMode={false}
        totalCost={0}
      />,
    );

    const frame = tree.lastFrame() ?? "";
    expect(frame).not.toContain("Ctrl+V");
    expect(frame).not.toContain("粘贴图片");
    tree.unmount();
  });

  it("never draws a line wider than a narrow terminal", () => {
    const tree = render(
      <BottomStatusBar
        remoteUrl="github.com/example/a-very-long-repository-name"
        isRemoteMode={false}
        services={{
          model: {
            model: {
              name: "a-very-long-model-name-with-a-suffix",
              defaultCompletionOptions: { contextLength: 200000 },
            },
          },
        }}
        navState={{ currentScreen: "chat" }}
        navigateTo={vi.fn()}
        closeCurrentScreen={vi.fn()}
        contextPercentage={42}
        contextTokens={14000}
        isVerboseMode={false}
        totalCost={0.42}
      />,
    );
    mounted.push(tree);

    const lines = (tree.lastFrame() ?? "").split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});
