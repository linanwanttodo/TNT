import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPermissionMode = vi.fn();

vi.mock("../../api/client.js", () => ({
  PERMISSION_MODE_OPTIONS: [
    {
      mode: "plan",
      label: "Plan",
      description: "Create a plan before making changes",
    },
    {
      mode: "default",
      label: "Manual",
      description: "Always ask before making changes",
    },
  ],
  setPermissionMode: (...args: unknown[]) => setPermissionMode(...(args as [])),
}));

import { StatusBar } from "./StatusBar.tsx";
import type {
  ChatModelOption,
  ContextBreakdown,
  WorktreeInfo,
} from "../../api/client.js";

const models: ChatModelOption[] = [
  {
    index: 0,
    name: "Deepseek-V4.1-Flash",
    provider: "deepseek",
    current: true,
  },
  { index: 1, name: "gpt-5.2", provider: "openai", current: false },
];

const worktrees: WorktreeInfo[] = [
  {
    path: "/repo/main",
    branch: "main",
    head: "a".repeat(40),
    detached: false,
    bare: false,
  },
  {
    path: "/repo/side",
    branch: "side",
    head: "b".repeat(40),
    detached: false,
    bare: false,
  },
];

const context: ContextBreakdown = {
  usedTokens: 12_345,
  contextLimit: 100_000,
  freeTokens: 87_655,
  percentUsed: 12.3,
  categories: {
    systemPrompt: 4_000,
    tools: 1_500,
    conversation: 5_345,
    toolResults: 1_500,
    contextItems: 0,
  },
};

describe("status bar", () => {
  beforeEach(() => {
    setPermissionMode.mockReset();
    setPermissionMode.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  function openMenu() {
    render(<StatusBar permissionMode="default" />);
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  }

  it("shows the picked label optimistically and reverts on failure", async () => {
    setPermissionMode.mockRejectedValueOnce(new Error("503"));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Plan/ }));
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manual" })).toBeTruthy(),
    );
  });

  it("keeps the picked mode when the server confirms it", async () => {
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Plan/ }));
    await waitFor(() => expect(setPermissionMode).toHaveBeenCalledWith("plan"));
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy();
  });

  it("closes the menu on Escape", () => {
    openMenu();
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("follows a mode the server reports later", () => {
    const { rerender } = render(<StatusBar permissionMode="default" />);
    rerender(<StatusBar permissionMode="plan" />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy();
  });

  it("no longer labels the machine the session runs on", () => {
    render(<StatusBar permissionMode="default" />);
    expect(screen.queryByText("This computer")).toBeNull();
  });

  it("shows the folder it runs in", () => {
    render(<StatusBar permissionMode="default" workspace="continue-webui" />);
    expect(screen.getByText("continue-webui")).toBeTruthy();
  });

  it("opens the model menu and switches on a pick", () => {
    const onPickModel = vi.fn();
    render(
      <StatusBar
        permissionMode="default"
        models={models}
        currentModel={models[0]}
        onPickModel={onPickModel}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Deepseek-V4.1-Flash" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /gpt-5.2/ }));
    expect(onPickModel).toHaveBeenCalledWith(1);
  });

  it("does not offer a model menu when the server offers none", () => {
    render(<StatusBar permissionMode="default" models={[]} />);
    expect(screen.queryByRole("button", { name: /model/i })).toBeNull();
  });

  it("renders the worktree chip grey until a checkout is picked", () => {
    const { rerender } = render(
      <StatusBar
        permissionMode="default"
        worktrees={worktrees}
        currentWorktree={worktrees[0]}
        worktreeSwitchable
        worktreeChosen={false}
      />,
    );
    const chip = screen.getByRole("button", { name: /Worktree|main/ });
    expect(chip.getAttribute("data-chosen")).toBe("false");
    rerender(
      <StatusBar
        permissionMode="default"
        worktrees={worktrees}
        currentWorktree={worktrees[0]}
        worktreeSwitchable
        worktreeChosen
      />,
    );
    expect(chip.getAttribute("data-chosen")).toBe("true");
  });

  it("switches worktree from the chip menu", () => {
    const onPickWorktree = vi.fn();
    render(
      <StatusBar
        permissionMode="default"
        worktrees={worktrees}
        currentWorktree={worktrees[0]}
        worktreeSwitchable
        onPickWorktree={onPickWorktree}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Worktree|main/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /side/ }));
    expect(onPickWorktree).toHaveBeenCalledWith("/repo/side");
  });

  it("keeps the worktree chip read-only when the server refuses moves", () => {
    render(
      <StatusBar
        permissionMode="default"
        worktrees={worktrees}
        currentWorktree={worktrees[0]}
        worktreeSwitchable={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Worktree|main/ })).toBeNull();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("shows the working spinner only while a turn is running", () => {
    const { rerender } = render(
      <StatusBar permissionMode="default" isProcessing={false} />,
    );
    expect(screen.queryByLabelText("Working")).toBeNull();
    rerender(<StatusBar permissionMode="default" isProcessing />);
    expect(screen.getByLabelText("Working")).toBeTruthy();
  });

  it("hides the context ring until a breakdown arrives", () => {
    render(<StatusBar permissionMode="default" />);
    expect(
      screen.queryByRole("button", { name: /Context .*% used/ }),
    ).toBeNull();
  });

  it("shows the context ring and opens its breakdown", () => {
    render(<StatusBar permissionMode="default" contextBreakdown={context} />);
    const ring = screen.getByRole("button", { name: "Context 12% used" });
    expect(ring.querySelector("circle")).toBeTruthy();
    fireEvent.click(ring);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Total tokens")).toBeTruthy();
    expect(screen.getByText("12.3K")).toBeTruthy();
    expect(screen.getByText("System prompt")).toBeTruthy();
    expect(screen.getByText("Tool definitions")).toBeTruthy();
    expect(screen.getByText("Conversation messages")).toBeTruthy();
    expect(screen.getByText("Tool results")).toBeTruthy();
    expect(screen.getByText("Free space")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
