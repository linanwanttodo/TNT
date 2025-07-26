import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutoCompactionState,
  MAX_CONSECUTIVE_COMPACTION_FAILURES,
} from "core/util/autoCompaction";
import { autoCompactIfNeeded } from "./autoCompaction";

function makeHarness(options?: { fail?: boolean }) {
  const actions: string[] = [];
  const request = vi.fn(async () => {
    if (options?.fail) {
      throw new Error("compaction rejected");
    }
    return { status: "success", content: undefined };
  });

  return {
    actions,
    request,
    input: {
      dispatch: ((action: { type: string }) => {
        actions.push(action.type);
        return action;
      }) as never,
      ideMessenger: { request } as never,
      sessionId: "session-1",
      historyLength: 4,
      contextPercentage: 0.9,
      state: createAutoCompactionState(),
    },
  };
}

describe("autoCompactIfNeeded", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does nothing while the window has room", async () => {
    const harness = makeHarness();
    const ran = await autoCompactIfNeeded({
      ...harness.input,
      contextPercentage: 0.2,
    });

    expect(ran).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.actions).toEqual([]);
  });

  it("compacts the last message and clears the stale reading", async () => {
    const harness = makeHarness();
    const ran = await autoCompactIfNeeded(harness.input);

    expect(ran).toBe(true);
    expect(harness.request).toHaveBeenCalledWith("conversation/compact", {
      index: 3,
      sessionId: "session-1",
    });
    expect(harness.actions).toContain("session/beginAutoCompaction");
    expect(harness.actions).toContain("session/autoCompactionSucceeded");
    expect(harness.actions).toContain("session/setContextPercentage");
    expect(harness.actions).toContain("session/setContextBreakdown");
  });

  it("counts a failure and keeps the breaker closed until it trips", async () => {
    const harness = makeHarness({ fail: true });
    const ran = await autoCompactIfNeeded(harness.input);

    expect(ran).toBe(false);
    expect(harness.actions).toContain("session/autoCompactionFailed");
    expect(harness.actions).not.toContain("session/autoCompactionSucceeded");
  });

  it("stops trying once the breaker has tripped", async () => {
    const harness = makeHarness();
    const ran = await autoCompactIfNeeded({
      ...harness.input,
      state: {
        consecutiveFailures: MAX_CONSECUTIVE_COMPACTION_FAILURES,
        inFlight: false,
      },
    });

    expect(ran).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it("skips an empty session", async () => {
    const harness = makeHarness();
    const ran = await autoCompactIfNeeded({
      ...harness.input,
      historyLength: 0,
    });

    expect(ran).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });
});
