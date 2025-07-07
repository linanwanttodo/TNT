import { describe, expect, it } from "vitest";

import { ExecutionGate } from "./gate.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ExecutionGate", () => {
  it("runs calls with no slots immediately", async () => {
    const gate = new ExecutionGate();
    const order: string[] = [];
    await Promise.all([
      gate.run([], async () => {
        order.push("a");
      }),
      gate.run([], async () => {
        order.push("b");
      }),
    ]);
    expect(order).toEqual(["a", "b"]);
  });

  it("serializes two calls that claim the same key", async () => {
    const gate = new ExecutionGate();
    const order: string[] = [];
    const first = deferred<void>();

    const a = gate.run(["src/a.ts"], async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });
    const b = gate.run(["src/a.ts"], async () => {
      order.push("b-start");
    });

    await Promise.resolve();
    expect(order).toEqual(["a-start"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("lets calls on different keys overlap", async () => {
    const gate = new ExecutionGate();
    const order: string[] = [];
    const first = deferred<void>();

    const a = gate.run(["src/a.ts"], async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });
    const b = gate.run(["src/b.ts"], async () => {
      order.push("b-start");
    });

    await b;
    expect(order).toEqual(["a-start", "b-start"]);
    first.resolve();
    await a;
  });

  it("serializes everything that holds the global slot", async () => {
    const gate = new ExecutionGate();
    const order: string[] = [];
    const first = deferred<void>();

    const a = gate.run([" global"], async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });
    const b = gate.run([" global"], async () => {
      order.push("b-start");
    });

    await Promise.resolve();
    expect(order).toEqual(["a-start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("releases the slot when the task throws", async () => {
    const gate = new ExecutionGate();
    await expect(
      gate.run(["src/a.ts"], async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const order: string[] = [];
    await gate.run(["src/a.ts"], async () => {
      order.push("after");
    });
    expect(order).toEqual(["after"]);
  });

  it("stops waiting after the timeout and proceeds anyway", async () => {
    const gate = new ExecutionGate(20);
    const records: string[] = [];
    gate.onBarrier((r) => records.push(`${r.key}:${r.outcome}`));

    const first = deferred<void>();
    const a = gate.run(["src/a.ts"], async () => {
      await first.promise;
    });

    const started = Date.now();
    await gate.run(["src/a.ts"], async () => {
      records.push("second-ran");
    });
    const elapsed = Date.now() - started;

    expect(records).toContain("src/a.ts:timeout");
    expect(records).toContain("second-ran");
    expect(elapsed).toBeLessThan(1000);
    first.resolve();
    await a;
  });

  it("does not serialize across separate keys after everything drains", async () => {
    const gate = new ExecutionGate();
    await gate.run(["src/a.ts"], async () => {});
    const order: string[] = [];
    await Promise.all([
      gate.run(["src/a.ts"], async () => {
        order.push("a");
      }),
      gate.run(["src/a.ts"], async () => {
        order.push("b");
      }),
    ]);
    expect(order).toEqual(["a", "b"]);
  });
});
