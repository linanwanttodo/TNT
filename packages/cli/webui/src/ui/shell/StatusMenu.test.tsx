import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusMenu } from "./StatusMenu.tsx";

const context = {
  usedTokens: 40_000,
  contextLimit: 1_000_000,
  freeTokens: 960_000,
  percentUsed: 4,
  categories: {
    systemPrompt: 10_000,
    tools: 5_000,
    conversation: 20_000,
    toolResults: 4_000,
    contextItems: 1_000,
  },
};

const git = {
  repo: true,
  path: "/work/project",
  branch: "main",
  head: "abcdef1234567890",
  detached: false,
  dirty: true,
  changedFiles: 3,
  changes: [
    { path: "src/a.ts", status: "modified", staged: true },
    { path: "docs/b.md", status: "untracked", staged: false },
    { path: "old.ts", status: "deleted", staged: false },
  ],
  latestCommit: { hash: "abc1234", subject: "Add the status menu" },
};

describe("StatusMenu", () => {
  afterEach(cleanup);

  it("opens the context, git, task and background panel", () => {
    render(
      <StatusMenu
        title="Test session"
        model="fast-model"
        permissionMode="default"
        context={context}
        git={git}
        isProcessing
        queueLength={2}
        hasPendingPermission
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Session status" }));

    expect(screen.getAllByText("4%").length).toBeGreaterThan(0);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("abc1234 Add the status menu")).toBeTruthy();
    expect(screen.getByText("3 changed")).toBeTruthy();
    expect(screen.getAllByText("2 queued").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(
      <StatusMenu
        title="Test session"
        model="fast-model"
        context={context}
        git={git}
        isProcessing={false}
        queueLength={0}
        hasPendingPermission={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Session status" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
