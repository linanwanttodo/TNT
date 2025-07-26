import { describe, expect, it } from "vitest";

import { runToolCallsOrdered } from "./toolCallConcurrency";

interface Call {
  id: string;
  readOnly: boolean;
}

const call = (id: string, readOnly: boolean): Call => ({ id, readOnly });

describe("runToolCallsOrdered", () => {
  it("runs consecutive read-only calls concurrently", async () => {
    const active: string[] = [];
    let maxConcurrent = 0;

    await runToolCallsOrdered(
      [call("a", true), call("b", true), call("c", true)],
      (c) => c.readOnly,
      async (c) => {
        active.push(c.id);
        maxConcurrent = Math.max(maxConcurrent, active.length);
        await Promise.resolve();
        active.splice(active.indexOf(c.id), 1);
      },
    );

    expect(maxConcurrent).toBe(3);
  });

  it("never runs two write calls at the same time", async () => {
    let activeWrites = 0;
    let sawOverlap = false;

    await runToolCallsOrdered(
      [call("a", false), call("b", false), call("c", false)],
      (c) => c.readOnly,
      async () => {
        activeWrites++;
        if (activeWrites > 1) {
          sawOverlap = true;
        }
        await Promise.resolve();
        activeWrites--;
      },
    );

    expect(sawOverlap).toBe(false);
  });

  it("preserves the original call order", async () => {
    const order: string[] = [];

    await runToolCallsOrdered(
      [call("a", true), call("b", false), call("c", true), call("d", true)],
      (c) => c.readOnly,
      async (c) => {
        order.push(c.id);
      },
    );

    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("waits for writes before starting the next batch of reads", async () => {
    const events: string[] = [];

    await runToolCallsOrdered(
      [call("read-1", true), call("write", false), call("read-2", true)],
      (c) => c.readOnly,
      async (c) => {
        events.push(`start:${c.id}`);
        await Promise.resolve();
        events.push(`end:${c.id}`);
      },
    );

    expect(events.indexOf("end:write")).toBeLessThan(
      events.indexOf("start:read-2"),
    );
  });

  it("handles an empty list", async () => {
    await expect(
      runToolCallsOrdered(
        [],
        () => true,
        async () => {},
      ),
    ).resolves.toBeUndefined();
  });
});
