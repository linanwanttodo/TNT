import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taskHook = vi.hoisted(() => ({ blocked: false, blockReason: "" }));
vi.mock("../hooks/fireHook.js", () => ({
  fireTaskCreated: vi.fn(async () => ({ ...taskHook })),
  fireTaskCompleted: vi.fn(async () => ({ ...taskHook })),
}));

import {
  beginTeamRun,
  clearSessionTeamRuns,
  finishTeamRun,
} from "../session/index.js";

import {
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
} from "./teamTasks.js";
import type { Tool } from "./types.js";

async function runText(
  tool: Tool,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await tool.run(args);
  if (typeof result !== "string")
    throw new Error("Expected a text tool result");
  return result;
}

beforeEach(() => {
  clearSessionTeamRuns();
  taskHook.blocked = false;
  taskHook.blockReason = "";
});

afterEach(() => {
  finishTeamRun("unused", "completed");
  clearSessionTeamRuns();
});

describe("team task tools", () => {
  it("creates, lists, assigns and completes dependent tasks", async () => {
    const run = beginTeamRun({
      team: "dev",
      goal: "ship",
      mode: "parallel",
      members: ["implementer", "tester"],
    });
    const first = JSON.parse(
      await runText(taskCreateTool, {
        subject: "Implement",
        description: "Route",
      }),
    );
    const second = JSON.parse(
      await runText(taskCreateTool, {
        subject: "Verify",
        depends_on: [first.taskId],
      }),
    );

    const listed = JSON.parse(await runText(taskListTool, {}));
    expect(listed).toEqual([
      expect.objectContaining({ taskId: first.taskId, blocked: false }),
      expect.objectContaining({ taskId: second.taskId, blocked: true }),
    ]);
    expect(
      await taskUpdateTool.run({
        task_id: second.taskId,
        status: "in_progress",
        owner: "tester",
      }),
    ).toMatch(/blocked/i);

    expect(
      JSON.parse(
        await runText(taskUpdateTool, {
          task_id: first.taskId,
          status: "in_progress",
          owner: "implementer",
        }),
      ),
    ).toMatchObject({ status: "in_progress", owner: "implementer" });
    expect(
      JSON.parse(
        await runText(taskUpdateTool, {
          task_id: first.taskId,
          status: "completed",
          owner: "implementer",
        }),
      ),
    ).toMatchObject({ status: "completed" });
    expect(
      JSON.parse(await runText(taskGetTool, { task_id: second.taskId })),
    ).toMatchObject({
      blocked: false,
      status: "pending",
    });
    expect(run.runId).toBeTruthy();
  });

  it("honors blocking task hooks before changing the shared list", async () => {
    beginTeamRun({
      team: "dev",
      goal: "ship",
      mode: "auto",
      members: ["implementer"],
    });
    taskHook.blocked = true;
    taskHook.blockReason = "Needs a smaller task.";

    expect(await runText(taskCreateTool, { subject: "Too broad" })).toMatch(
      /Needs a smaller task/,
    );
    expect(JSON.parse(await runText(taskListTool, {}))).toEqual([]);

    taskHook.blocked = false;
    const task = JSON.parse(
      await runText(taskCreateTool, { subject: "Implement" }),
    );
    await runText(taskUpdateTool, {
      task_id: task.taskId,
      status: "in_progress",
      owner: "implementer",
    });
    taskHook.blocked = true;
    taskHook.blockReason = "Tests are missing.";

    expect(
      await runText(taskUpdateTool, {
        task_id: task.taskId,
        status: "completed",
        owner: "implementer",
      }),
    ).toMatch(/Tests are missing/);
    expect(
      JSON.parse(await runText(taskGetTool, { task_id: task.taskId })),
    ).toMatchObject({
      status: "in_progress",
    });
  });

  it("refuses task work without an active team", async () => {
    expect(await taskCreateTool.run({ subject: "Injected" })).toMatch(
      /no active team/i,
    );
    expect(await taskListTool.run({})).toMatch(/no active team/i);
  });
});
