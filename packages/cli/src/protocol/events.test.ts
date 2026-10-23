import { describe, expect, it } from "vitest";

import { createCommandId } from "./commands.js";
import { EventGate, createEventSequence } from "./events.js";

describe("agent event sequence", () => {
  it("stamps one turn with a monotonic seq and a stable identity", () => {
    const sequence = createEventSequence("session-1", "turn-1", () => 42);

    const first = sequence.next({ type: "content.delta", delta: "a" });
    const second = sequence.next({ type: "content.delta", delta: "b" });

    expect(first).toMatchObject({
      sessionId: "session-1",
      turnId: "turn-1",
      seq: 1,
      timestamp: 42,
    });
    expect(second.seq).toBe(2);
    expect(sequence.lastSeq()).toBe(2);
  });

  it("drops an event the surface has already passed", () => {
    const sequence = createEventSequence("session-1", "turn-1");
    const gate = new EventGate();
    const first = sequence.next({
      type: "turn.started",
      model: "m",
      historyLength: 0,
    });
    const second = sequence.next({ type: "content.delta", delta: "x" });

    expect(gate.accept(first)).toBe(true);
    expect(gate.accept(second)).toBe(true);
    expect(gate.accept(first)).toBe(false);
  });

  it("keeps watermarks separate per turn", () => {
    const gate = new EventGate();
    const firstTurn = createEventSequence("s", "turn-1");
    const secondTurn = createEventSequence("s", "turn-2");

    expect(gate.accept(firstTurn.next({ type: "notice", message: "a" }))).toBe(
      true,
    );
    expect(gate.accept(secondTurn.next({ type: "notice", message: "b" }))).toBe(
      true,
    );
  });
});

describe("agent command identity", () => {
  it("creates a stable-prefixed id", () => {
    expect(createCommandId(() => 7)).toMatch(/^cmd-7-/);
  });
});
