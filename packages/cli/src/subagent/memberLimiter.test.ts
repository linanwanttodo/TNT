import { afterEach, describe, expect, it } from "vitest";

import {
  acquireTeamMemberSlot,
  getActiveTeamMemberCount,
  releaseTeamMemberSlot,
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

describe("queued dispatch cancellation", () => {
  afterEach(() => {
    resetTeamMemberLimiter(2);
  });

  it("rejects an already-aborted dispatch without taking a slot", async () => {
    resetTeamMemberLimiter(2);
    const controller = new AbortController();
    controller.abort();
    await expect(acquireTeamMemberSlot(controller.signal)).rejects.toThrow(
      /cancelled by the user/,
    );
    expect(getActiveTeamMemberCount()).toBe(0);
  });

  it("cancels a queued dispatch when its signal fires, leaving the FIFO clean", async () => {
    resetTeamMemberLimiter(1);
    await acquireTeamMemberSlot();

    const controller = new AbortController();
    const queued = acquireTeamMemberSlot(controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(queued).rejects.toThrow(/cancelled by the user/);

    // The waiter left the FIFO, so a release frees the held slot outright
    // instead of transferring it to a ghost.
    releaseTeamMemberSlot();
    expect(getActiveTeamMemberCount()).toBe(0);
  });

  it("resolves a queued dispatch released before its abort fires", async () => {
    resetTeamMemberLimiter(1);
    await acquireTeamMemberSlot();

    const controller = new AbortController();
    const queued = acquireTeamMemberSlot(controller.signal);
    await Promise.resolve();
    releaseTeamMemberSlot();
    controller.abort();

    await expect(queued).resolves.toBeUndefined();
    // The slot transferred to the waiter; releasing it again frees the count.
    releaseTeamMemberSlot();
    expect(getActiveTeamMemberCount()).toBe(0);
  });
});
