import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchState = vi.fn();
const fetchSessions = vi.fn();

vi.mock("./api/client.js", () => ({
  connectEvents: () => () => {},
  fetchState: () => fetchState(),
  fetchSessions: () => fetchSessions(),
  fetchGitStatus: vi.fn(async () => ({
    repo: false,
    path: "",
    branch: null,
    head: "",
    detached: false,
    dirty: false,
    changedFiles: 0,
    changes: [],
  })),
  fetchContextBreakdown: vi.fn(async () => ({})),
  deleteSession: vi.fn(async () => undefined),
  renameSession: vi.fn(async () => undefined),
  fetchWorktrees: vi.fn(async () => ({ worktrees: [], current: null })),
  stopTurn: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  approve: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  PERMISSION_MODE_OPTIONS: [
    { mode: "default", label: "Manual", description: "Always ask first" },
  ],
}));

import { App } from "./App.tsx";
import { useSessionStore } from "./stores/session-store.js";

const SESSIONS = [
  {
    sessionId: "s1",
    title: "Retrieval review",
    workspaceDirectory: "/home/lin/continue",
    dateCreated: "",
  },
  {
    sessionId: "s2",
    title: "Older thread",
    workspaceDirectory: "/home/lin/continue",
    dateCreated: "",
  },
];

describe("app shell", () => {
  beforeEach(() => {
    useSessionStore.setState({ items: [], streaming: null, isWaiting: false });
    fetchState.mockResolvedValue({
      session: {
        sessionId: "s1",
        title: "Retrieval review",
        history: [],
        workspaceDirectory: "/home/lin/continue",
        chatModelTitle: "deepseek-v4",
      },
      isProcessing: false,
      messageQueueLength: 0,
      pendingPermission: null,
    });
    fetchSessions.mockResolvedValue(SESSIONS);
  });

  afterEach(cleanup);

  it("marks the session the server reports as the active row", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Older thread")).toBeTruthy());
    // The row also carries a relative timestamp next to the title, so the
    // assertion reads the row through its title instead of the whole text.
    // The title appears more than once (row and its actions menu), so take
    // the first and climb to the row.
    const activeRow = screen
      .getAllByText("Retrieval review")[0]
      .closest("[data-active]");
    expect(activeRow?.getAttribute("data-active")).toBe("true");
  });

  it("shows the workspace the session reports", async () => {
    const { container } = render(<App />);
    // The rail groups by workspace too, so read the strip that used to
    // invent "continue" as a default.
    await waitFor(() =>
      expect(container.querySelector("footer")?.textContent).toContain(
        "continue",
      ),
    );
  });
});
