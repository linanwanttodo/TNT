import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { SessionSelectorWithLoading } from "./SessionSelectorWithLoading.js";

vi.mock("../../session/index.js", () => ({
  listSessions: vi.fn(async () => []),
  loadSessionById: vi.fn(() => null),
  listSubagentSessions: vi.fn(() => [
    {
      sessionId: "parent:one",
      title: "Explore session",
      dateCreated: new Date("2026-01-01T00:00:00Z").toISOString(),
      workspaceDirectory: "/tmp",
      subagentType: "Explore",
    },
  ]),
}));

describe("SessionSelectorWithLoading subagent source", () => {
  it("lists the delegated runs of the parent session", async () => {
    const tree = render(
      <SessionSelectorWithLoading
        source="subagents"
        parentSessionId="parent"
        onSelect={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      expect(tree.lastFrame() ?? "").toContain("Explore session");
    });
    tree.unmount();

    const { listSessions, listSubagentSessions } = await import(
      "../../session/index.js"
    );
    expect(listSubagentSessions).toHaveBeenCalledWith("parent");
    expect(listSessions).not.toHaveBeenCalled();
  });
});
