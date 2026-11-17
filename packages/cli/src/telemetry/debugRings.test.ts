import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDebugRounds,
  readNetworkDebug,
  recordDebugRound,
  recordNetworkDebug,
  resetDebugRings,
} from "./debugRings.js";

/**
 * The rings are the developer panel's only source, so the tests pin the two
 * properties the panel relies on: each conversation is bounded, and what it
 * reads back is in the order the panel renders.
 */

const round = (inputTokens: number) => ({
  usage: { inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 },
  hitRate: 0.5,
  generationDurationMs: 1000,
  tokensPerSecond: 10,
});

describe("the developer panel's rings", () => {
  beforeEach(() => {
    resetDebugRings();
    vi.useRealTimers();
  });

  it("numbers a conversation's rounds from one and keeps them oldest first", () => {
    recordDebugRound("tnt-a", round(100));
    recordDebugRound("tnt-a", round(200));

    const rounds = readDebugRounds("tnt-a");

    expect(rounds.map((entry) => entry.requestIndex)).toEqual([1, 2]);
    expect(rounds.map((entry) => entry.usage.inputTokens)).toEqual([100, 200]);
    expect(new Set(rounds.map((entry) => entry.eventKey)).size).toBe(2);
  });

  it("reads back only the tail when the panel asks for less", () => {
    for (let index = 0; index < 5; index += 1) {
      recordDebugRound("tnt-a", round(index));
    }

    expect(
      readDebugRounds("tnt-a", 2).map((entry) => entry.requestIndex),
    ).toEqual([4, 5]);
  });

  it("drops the oldest rounds once a conversation reaches its bound", () => {
    for (let index = 0; index < 205; index += 1) {
      recordDebugRound("tnt-a", round(index));
    }

    const rounds = readDebugRounds("tnt-a");

    expect(rounds).toHaveLength(200);
    expect(rounds[0].requestIndex).toBe(6);
    expect(rounds.at(-1)?.requestIndex).toBe(205);
  });

  it("keeps conversations apart", () => {
    recordDebugRound("tnt-a", round(1));
    recordDebugRound("tnt-b", round(2));

    expect(readDebugRounds("tnt-a")).toHaveLength(1);
    expect(readDebugRounds("tnt-a")[0].usage.inputTokens).toBe(1);
    expect(readDebugRounds("tnt-missing")).toEqual([]);
  });

  it("ignores a round with no conversation to file it under", () => {
    recordDebugRound(undefined, round(1));

    expect(readDebugRounds("tnt-a")).toEqual([]);
  });

  it("carries the round's sections through unchanged", () => {
    recordDebugRound("tnt-a", {
      ...round(100),
      sections: { system: 10, tools: 20, messages: 60, hookNotes: 10 },
    });

    expect(readDebugRounds("tnt-a")[0].sections).toEqual({
      system: 10,
      tools: 20,
      messages: 60,
      hookNotes: 10,
    });
  });

  it("lists network facts newest first and leaves the headers it never saw empty", () => {
    recordNetworkDebug("tnt-a", { statusType: "model_request_started" });
    recordNetworkDebug("tnt-a", {
      statusType: "model_retry_scheduled",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      reason: "ECONNRESET",
    });

    const entries = readNetworkDebug("tnt-a");

    expect(entries.map((entry) => entry.statusType)).toEqual([
      "model_retry_scheduled",
      "model_request_started",
    ]);
    expect(entries[0].delayMs).toBe(1000);
    expect(entries[0].requestHeaders).toEqual({});
    expect(entries[0].requestHeaderCount).toBe(0);
    expect(typeof entries[0].timestamp).toBe("string");
  });

  it("bounds the network ring the same way", () => {
    for (let index = 0; index < 105; index += 1) {
      recordNetworkDebug("tnt-a", { statusType: "model_request_started" });
    }

    expect(readNetworkDebug("tnt-a")).toHaveLength(100);
  });

  it("holds a bounded number of conversations", () => {
    for (let index = 0; index < 20; index += 1) {
      recordDebugRound(`tnt-${index}`, round(index));
    }

    expect(readDebugRounds("tnt-0")).toEqual([]);
    expect(readDebugRounds("tnt-19")).toHaveLength(1);
  });

  it("records a timestamp close to now", () => {
    const before = Date.now();
    recordDebugRound("tnt-a", round(1));

    const recordedAt = readDebugRounds("tnt-a")[0].recordedAt;

    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(Date.now());
  });
});
