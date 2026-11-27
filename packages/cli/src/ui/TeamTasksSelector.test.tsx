import type { TeamTaskView } from "core/index.js";
import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listTeamTasks = vi.hoisted(() => vi.fn());
const getCurrentTeamRunId = vi.hoisted(() => vi.fn(() => "team-1"));
const getSessionTeamRuns = vi.hoisted(() => vi.fn((): any[] => []));
const updateTask = vi.hoisted(() => vi.fn());

vi.mock("../session/index.js", () => ({
  getCurrentTeamRunId,
  getSessionTeamRuns,
  listTeamTasks,
  subscribeTeamRunChanges: () => () => undefined,
}));
vi.mock("../tools/teamTasks.js", () => ({
  taskUpdateTool: { run: (...args: unknown[]) => updateTask(...args) },
}));

import { TeamTasksSelector } from "./TeamTasksSelector.js";
import { ThemeProvider, darkTheme } from "./theme/tokens.js";

const tasks: TeamTaskView[] = [
  {
    taskId: "task-1",
    subject: "Inspect isolation",
    description: "Verify child tools use the worktree.",
    status: "pending",
    dependsOn: [],
    blocked: false,
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
  },
  {
    taskId: "task-2",
    subject: "Run verification",
    status: "pending",
    dependsOn: ["task-1"],
    blocked: true,
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTeamRunId.mockReturnValue("team-1");
  getSessionTeamRuns.mockReturnValue([
    {
      runId: "team-1",
      team: "dev",
      status: "running",
      members: [{ name: "alpha" }, { name: "beta" }],
    },
  ]);
  listTeamTasks.mockReturnValue(tasks);
  updateTask.mockResolvedValue(
    JSON.stringify({ ...tasks[0], status: "in_progress", owner: "alpha" }),
  );
});

describe("TeamTasksSelector", () => {
  it("navigates, shows dependencies and updates the selected task", async () => {
    const onCancel = vi.fn();
    const view = render(
      <ThemeProvider theme={darkTheme}>
        <TeamTasksSelector onCancel={onCancel} />
      </ThemeProvider>,
    );

    expect(view.lastFrame()).toContain("Inspect isolation");
    expect(view.lastFrame()).toContain("Run verification");
    expect(view.lastFrame()).toContain("blocked");

    view.stdin.write("\u001b[B");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain(">  pending     Run verification"),
    );
    view.stdin.write("\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Depends on: task-1");
    });

    view.stdin.write("b");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Up/Down to navigate"),
    );
    view.stdin.write("\u001b[A");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain(">  pending     Inspect isolation"),
    );
    view.stdin.write("\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain(
        "Verify child tools use the worktree.",
      );
    });
    view.stdin.write(" ");
    await vi.waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith({
        task_id: "task-1",
        status: "in_progress",
        owner: "alpha",
      });
    });

    view.stdin.write("c");
    await vi.waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith({
        task_id: "task-1",
        status: "completed",
        owner: "alpha",
      });
    });
    view.unmount();
  });

  it("closes with Escape", () => {
    const onCancel = vi.fn();
    const view = render(
      <ThemeProvider theme={darkTheme}>
        <TeamTasksSelector onCancel={onCancel} />
      </ThemeProvider>,
    );
    view.stdin.write("\u001b");
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
  });
});
