import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchState = vi.fn();
const fetchSessions = vi.fn();
const fetchGitStatus = vi.fn();
const fetchContextBreakdown = vi.fn();

// The shell grew more client calls than this file first named, so the module is
// spread rather than re-listed: whatever the shell imports is real until the
// test below overrides it.
vi.mock("./api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/client.js")>()),
  connectEvents: () => () => {},
  fetchState: () => fetchState(),
  fetchSessions: () => fetchSessions(),
  fetchGitStatus: () => fetchGitStatus(),
  fetchContextBreakdown: () => fetchContextBreakdown(),
  stopTurn: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  approve: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
}));

import { App } from "./App.tsx";
import { useSessionStore } from "./stores/session-store.js";

const WORKSPACE = "/home/lin/ret-review";

const SESSIONS = [
  {
    sessionId: "s1",
    title: "Retrieval review",
    workspaceDirectory: WORKSPACE,
    dateCreated: "",
  },
  {
    sessionId: "s2",
    title: "Older thread",
    workspaceDirectory: WORKSPACE,
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
        workspaceDirectory: WORKSPACE,
        chatModelTitle: "deepseek-v4",
      },
      isProcessing: false,
      messageQueueLength: 0,
      pendingPermission: null,
    });
    fetchSessions.mockResolvedValue(SESSIONS);
    fetchGitStatus.mockResolvedValue({
      repo: false,
      path: WORKSPACE,
      branch: null,
      head: "",
      detached: false,
      dirty: false,
      changedFiles: 0,
      changes: [],
      latestCommit: null,
    });
    fetchContextBreakdown.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("marks the session the server reports as the active row", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Older thread")).toBeTruthy());
    // data-active lives on other chrome too and the title is repeated in the
    // header, so read it off the row that carries the session's own title.
    const rowState = (title: string) =>
      screen
        .getAllByText(title)
        .map((node) => node.closest("button[data-active]"))
        .find((row) => row !== null)
        ?.getAttribute("data-active");
    expect(rowState("Retrieval review")).toBe("true");
    expect(rowState("Older thread")).toBe("false");
  });

  it("shows the workspace the session reports", async () => {
    const { container } = render(<App />);
    // The rail groups by workspace too, so read the strip that used to
    // invent a folder name the session never reported.
    await waitFor(() =>
      expect(container.querySelector("footer")?.textContent).toContain(
        "ret-review",
      ),
    );
  });
});
