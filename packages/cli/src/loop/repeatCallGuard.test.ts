import { describe, expect, it } from "vitest";

import {
  normalizeRepeatCallArguments,
  RepeatCallGuard,
} from "./repeatCallGuard.js";

const READ_ARGS = '{"filepath":"/x.txt"}';

function noticesFor(
  guard: RepeatCallGuard,
  times: number,
  toolName = "Read",
  argumentsJson = READ_ARGS,
): Array<string | undefined> {
  return Array.from({ length: times }, () =>
    guard.record(toolName, argumentsJson),
  );
}

describe("RepeatCallGuard", () => {
  it("stays silent for the first two identical calls and advises on the third", () => {
    const guard = new RepeatCallGuard();

    expect(guard.record("Read", READ_ARGS)).toBeUndefined();
    expect(guard.record("Read", READ_ARGS)).toBeUndefined();
    expect(guard.record("Read", READ_ARGS)).toContain("3 times in a row");
  });

  it("advises again at five and eight and stops talking after that", () => {
    const guard = new RepeatCallGuard();
    const notices = noticesFor(guard, 9);

    expect(notices[0]).toBeUndefined();
    expect(notices[1]).toBeUndefined();
    expect(notices[2]).toContain("Read");
    expect(notices[3]).toBeUndefined();
    expect(notices[4]).toContain("5 times in a row");
    expect(notices[5]).toBeUndefined();
    expect(notices[6]).toBeUndefined();
    expect(notices[7]).toContain("8 times in a row");
    expect(notices[8]).toBeUndefined();
  });

  it("starts a new streak when an argument changes", () => {
    const guard = new RepeatCallGuard();
    noticesFor(guard, 2);

    expect(guard.record("Read", '{"filepath":"/y.txt"}')).toBeUndefined();
    expect(guard.consecutiveCalls).toBe(1);
    expect(guard.record("Read", '{"filepath":"/y.txt"}')).toBeUndefined();
    expect(guard.record("Read", '{"filepath":"/y.txt"}')).toContain(
      "3 times in a row",
    );
  });

  it("keeps the tool name as part of the identity", () => {
    const guard = new RepeatCallGuard();
    noticesFor(guard, 2, "Read");

    expect(guard.record("List", READ_ARGS)).toBeUndefined();
    expect(guard.record("List", READ_ARGS)).toBeUndefined();
    expect(guard.record("List", READ_ARGS)).toContain("List");
  });

  it("starts from zero after resetForNewTurn", () => {
    const guard = new RepeatCallGuard();
    noticesFor(guard, 3);
    expect(guard.consecutiveCalls).toBe(3);

    guard.resetForNewTurn();
    expect(guard.consecutiveCalls).toBe(0);
    expect(guard.record("Read", READ_ARGS)).toBeUndefined();
    expect(guard.consecutiveCalls).toBe(1);
  });

  it("emits exactly three notices across ten identical calls", () => {
    const guard = new RepeatCallGuard();
    const notices = noticesFor(guard, 10).filter((notice): notice is string =>
      Boolean(notice),
    );

    expect(notices).toHaveLength(3);
  });

  it("treats equivalent documents with different key order as one call", () => {
    const guard = new RepeatCallGuard();

    expect(guard.record("Write", '{"a":1,"b":{"c":2,"d":3}}')).toBeUndefined();
    expect(guard.record("Write", '{"b":{"d":3,"c":2},"a":1}')).toBeUndefined();
    expect(guard.record("Write", '{"a":1,"b":{"c":2,"d":3}}')).toContain(
      "3 times in a row",
    );
    expect(normalizeRepeatCallArguments('{"b":2,"a":1}')).toBe('{"a":1,"b":2}');
  });

  it("names the tool and quotes a bounded argument summary from the second notice", () => {
    const guard = new RepeatCallGuard();
    const longArguments = JSON.stringify({ query: "x".repeat(1000) });
    const notices = noticesFor(guard, 5, "Grep", longArguments);

    // The first notice stays gentle and does not quote the arguments; the
    // later ones say which call and how much of its input.
    expect(notices[2]).toContain("Grep");
    expect(notices[2]).not.toContain("x".repeat(50));
    const second = notices[4] ?? "";
    expect(second).toContain("Grep");
    expect(second).toContain("5 times in a row");
    expect(second).toContain("x".repeat(50));
    expect(second).toContain("...");
    expect(second.length).toBeLessThan(500);
  });

  it("keeps a non-JSON argument document rather than dropping the streak", () => {
    const guard = new RepeatCallGuard();

    guard.record("Bash", "not json");
    guard.record("Bash", "not json");
    expect(guard.record("Bash", "not json")).toContain("3 times in a row");
  });
});
