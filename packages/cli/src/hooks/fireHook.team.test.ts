import { beforeEach, describe, expect, it, vi } from "vitest";

const fireEvent = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({ blocked: false, results: [] })),
);
vi.mock("../services/index.js", () => ({
  services: {
    hooks: { isReady: () => true, fireEvent },
    toolPermissions: { isReady: () => false },
  },
}));
vi.mock("../session/index.js", () => ({
  getCurrentSession: () => ({ sessionId: "session-1" }),
  getSessionFilePath: () => "/tmp/session-1.jsonl",
}));

import {
  fireTaskCompleted,
  fireTaskCreated,
  fireTeammateIdle,
} from "./fireHook.js";

beforeEach(() => fireEvent.mockClear());

describe("team lifecycle hooks", () => {
  it("emits task creation and completion with stable identities", async () => {
    await fireTaskCreated(
      "task-1",
      "Implement endpoint",
      "Wire route",
      "implementer",
    );
    await fireTaskCompleted(
      "task-1",
      "Implement endpoint",
      "Wire route",
      "implementer",
    );

    expect(fireEvent.mock.calls[0][0]).toMatchObject({
      hook_event_name: "TaskCreated",
      session_id: "session-1",
      task_id: "task-1",
      task_subject: "Implement endpoint",
      teammate_name: "implementer",
    });
    expect(fireEvent.mock.calls[1][0]).toMatchObject({
      hook_event_name: "TaskCompleted",
      task_id: "task-1",
      teammate_name: "implementer",
    });
  });

  it("emits teammate idle with the final answer", async () => {
    await fireTeammateIdle("tester", "All checks pass.");

    expect(fireEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: "TeammateIdle",
        teammate_name: "tester",
        last_assistant_message: "All checks pass.",
      }),
    );
  });
});
