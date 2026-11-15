import { describe, expect, it } from "vitest";

import { claimForToolCall, GLOBAL_SLOT } from "./concurrency.js";
import { ExecutionGate } from "./gate.js";

/**
 * Slots for one call, exactly as the stream executor derives them before
 * handing them to the gate (`planned.keys`, with an unresolved claim falling
 * back to the global slot).
 */
function slotsFor(name: string, args: Record<string, unknown>): string[] {
  const claim = claimForToolCall(name, args);
  return claim.exclusive ? [GLOBAL_SLOT] : [...claim.keys];
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("write barrier", () => {
  it("serializes two edits to the same file", async () => {
    const gate = new ExecutionGate();
    const file = { file_path: "src/a.ts" };
    const order: string[] = [];
    const firstIsRunning = deferred();

    const first = gate.run(slotsFor("Edit", file), async () => {
      order.push("first-start");
      await firstIsRunning.promise;
      order.push("first-end");
    });
    const second = gate.run(slotsFor("Edit", file), async () => {
      order.push("second-start");
    });

    // The second edit must not start while the first still holds the file.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);

    firstIsRunning.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("does not lose an update when two edits race on one file", async () => {
    const gate = new ExecutionGate();
    const file = { file_path: "src/a.ts" };
    let content = "0";

    const append = (value: string) => async () => {
      const current = content;
      // Yield like a real read-modify-write tool does between read and write.
      await Promise.resolve();
      content = `${current}${value}`;
    };

    await Promise.all([
      gate.run(slotsFor("Edit", file), append("a")),
      gate.run(slotsFor("Edit", file), append("b")),
    ]);

    expect(content).toBe("0ab");
  });

  it("runs edits to different files in parallel", async () => {
    const gate = new ExecutionGate();
    const order: string[] = [];
    const firstIsRunning = deferred();

    const first = gate.run(
      slotsFor("Edit", { file_path: "src/a.ts" }),
      async () => {
        order.push("a-start");
        await firstIsRunning.promise;
        order.push("a-end");
      },
    );
    const second = gate.run(
      slotsFor("Edit", { file_path: "src/b.ts" }),
      async () => {
        order.push("b-start");
      },
    );

    // The second file is free, so it runs while the first is still open.
    await second;
    expect(order).toEqual(["a-start", "b-start"]);

    firstIsRunning.resolve();
    await first;
    expect(order).toEqual(["a-start", "b-start", "a-end"]);
  });

  it("serializes Write and Edit when they name the same file", async () => {
    const gate = new ExecutionGate();
    const order: string[] = [];
    const firstIsRunning = deferred();

    const write = gate.run(
      slotsFor("Write", { filepath: "src/a.ts", content: "x" }),
      async () => {
        order.push("write-start");
        await firstIsRunning.promise;
        order.push("write-end");
      },
    );
    const edit = gate.run(
      slotsFor("Edit", { file_path: "src/a.ts" }),
      async () => {
        order.push("edit-start");
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["write-start"]);

    firstIsRunning.resolve();
    await Promise.all([write, edit]);
    expect(order).toEqual(["write-start", "write-end", "edit-start"]);
  });
});
