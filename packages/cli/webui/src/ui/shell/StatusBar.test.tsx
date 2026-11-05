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
    // Optimistic label first.
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy();
    // Failure restores the previous mode.
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

  it("shows no host, worktree or routing group it was not told", () => {
    const { container } = render(<StatusBar permissionMode="default" />);
    // The strip used to default these to invented text, so it stated facts
    // the session never reported.
    expect(screen.queryByText("This computer")).toBeNull();
    expect(screen.queryByText("Worktree")).toBeNull();
    expect(container.textContent).not.toContain("routing group");
  });

  it("shows the spinner only while a turn runs", () => {
    const { container, rerender } = render(<StatusBar permissionMode="auto" />);
    expect(container.querySelector("[data-waiting]")).toBeNull();
    rerender(<StatusBar permissionMode="auto" waiting />);
    expect(container.querySelector("[data-waiting]")).toBeTruthy();
  });
});
