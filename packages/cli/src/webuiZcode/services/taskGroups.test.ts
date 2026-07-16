import { describe, expect, it } from "vitest";

import { createTntTaskGroupService } from "./taskGroups.js";

describe("createTntTaskGroupService", () => {
  it("reads the empty structure TNT actually has", async () => {
    const service = createTntTaskGroupService();

    await expect(service.read()).resolves.toEqual({
      groups: [],
      members: [],
      order: [],
    });
  });

  it("accepts an ungrouped placement, which is the real state", async () => {
    const service = createTntTaskGroupService();

    await expect(
      service.admit({
        tasks: [
          { hostId: "local", workspacePath: "/tmp/ws", taskId: "sess-1" },
        ],
        placement: {
          task: { hostId: "local", workspacePath: "/tmp/ws", taskId: "sess-1" },
          groupId: null,
          creationId: "cmd-1",
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a placement into a group that does not exist", async () => {
    const service = createTntTaskGroupService();

    await expect(
      service.admit({
        tasks: [],
        placement: {
          task: { hostId: "local", workspacePath: "/tmp/ws", taskId: "sess-1" },
          groupId: "group-1",
          creationId: "cmd-1",
        },
      }),
    ).rejects.toThrow(/no such task group/);
  });

  it("rejects group writes instead of pretending they were stored", async () => {
    const service = createTntTaskGroupService();

    await expect(service.save({ title: "Group" })).rejects.toThrow(
      /ZCODE_UNAVAILABLE/,
    );
    await expect(service.ungroup("group-1")).rejects.toThrow(
      /ZCODE_UNAVAILABLE/,
    );
    await expect(
      service.move({
        node: {
          type: "task",
          task: { hostId: "local", workspacePath: "/tmp/ws", taskId: "sess-1" },
        },
        sourceGroupId: null,
        groupId: "group-1",
      }),
    ).rejects.toThrow(/ZCODE_UNAVAILABLE/);
  });
});
