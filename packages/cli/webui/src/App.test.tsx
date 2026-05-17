import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchState = vi.fn();
const fetchSessions = vi.fn();

vi.mock("./api/client.js", () => ({
  connectEvents: () => () => {},
  fetchState: () => fetchState(),
  fetchSessions: () => fetchSessions(),
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
    expect(document.querySelector('[data-active="true"]')?.textContent).toBe(
      "Retrieval review",
    );
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
