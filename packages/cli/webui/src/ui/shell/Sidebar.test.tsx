import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionSummary } from "../../api/client.js";

import { Sidebar, groupSessions } from "./Sidebar.tsx";

function session(
  sessionId: string,
  workspaceDirectory: string,
  updatedAt: string,
): SessionSummary {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    workspaceDirectory,
    dateCreated: updatedAt,
    updatedAt,
  };
}

describe("sidebar session grouping", () => {
  const sessions = [
    session("one", "/work/alpha", "2026-01-01T00:00:00.000Z"),
    session("two", "/work/beta", "2026-01-02T00:00:00.000Z"),
    session("three", "/work/alpha", "2026-01-03T00:00:00.000Z"),
    session("four", "/other/alpha", "2026-01-04T00:00:00.000Z"),
  ];

  it("keeps same-named folders separate and sorts by the newest session", () => {
    const groups = groupSessions(sessions);

    expect(groups.map((group) => group.path)).toEqual([
      "/other/alpha",
      "/work/alpha",
      "/work/beta",
    ]);
    expect(groups[1]?.sessions.map((item) => item.sessionId)).toEqual([
      "three",
      "one",
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      "alpha",
      "alpha",
      "beta",
    ]);
  });

  it("does not draw a decorative branch icon on each session", () => {
    const groups = groupSessions(sessions);
    const { container } = render(
      <Sidebar groups={groups} activeSessionId="three" />,
    );

    expect(
      container.querySelector('[data-icon="dsh-shell-icon-branch"]'),
    ).toBeNull();
    expect(screen.getAllByText("Session three").length).toBeGreaterThan(0);
  });

  afterEach(cleanup);
});
