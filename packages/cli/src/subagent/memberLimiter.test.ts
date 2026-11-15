import { afterEach, describe, expect, it } from "vitest";

import {
  getActiveTeamMemberCount,
  resetTeamMemberLimiter,
  withTeamMemberSlot,
} from "./memberLimiter.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  resetTeamMemberLimiter();
});

describe("team member concurrency", () => {
  it("runs no more than the configured number of members at once", async () => {
    resetTeamMemberLimiter(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());

    const tasks = gates.map((gate) =>
      withTeamMemberSlot(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );

    // Let the first wave start.
    await Promise.resolve();
    await Promise.resolve();
    expect(running).toBe(2);

    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(tasks);

    expect(peak).toBe(2);
    expect(getActiveTeamMemberCount()).toBe(0);
  });

  it("queues rather than drops work, and runs it in arrival order", async () => {
    resetTeamMemberLimiter(1);
    const order: string[] = [];
    const first = deferred();

    const a = withTeamMemberSlot(async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });
    const b = withTeamMemberSlot(async () => {
      order.push("b-start");
    });
    const c = withTeamMemberSlot(async () => {
      order.push("c-start");
    });

    await Promise.resolve();
    expect(order).toEqual(["a-start"]);

    first.resolve();
    await Promise.all([a, b, c]);

    expect(order).toEqual(["a-start", "a-end", "b-start", "c-start"]);
  });

  it("releases the slot when a member fails", async () => {
    resetTeamMemberLimiter(1);

    await expect(
      withTeamMemberSlot(async () => {
        throw new Error("member failed");
      }),
    ).rejects.toThrow("member failed");

    const ran = await withTeamMemberSlot(async () => "next");
    expect(ran).toBe("next");
    expect(getActiveTeamMemberCount()).toBe(0);
  });
});
