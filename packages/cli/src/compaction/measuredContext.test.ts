import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMeasuredRequests,
  measuredInputTokens,
  measuredRequestFor,
  noteMeasuredRequest,
  recordMeasuredRequest,
  type MeasuredRequest,
} from "./measuredContext.js";

const base: MeasuredRequest = {
  promptTokens: 1000,
  historyLength: 2,
  prefixKey: "prefix-a",
};

describe("measuredInputTokens", () => {
  it("reports nothing before a request has been measured", () => {
    expect(
      measuredInputTokens(undefined, {
        historyLength: 5,
        prefixKey: "prefix-a",
        tailTokens: 200,
      }),
    ).toBeUndefined();
  });

  it("counts only what was appended since the measurement", () => {
    expect(
      measuredInputTokens(base, {
        historyLength: 3,
        prefixKey: "prefix-a",
        tailTokens: 40,
      }),
    ).toBe(1040);
  });

  it("refuses the measurement when the cache prefix moved", () => {
    // A mode switch rewrites the system message, so the measured request no
    // longer describes what the next one will cost.
    expect(
      measuredInputTokens(base, {
        historyLength: 2,
        prefixKey: "prefix-b",
        tailTokens: 0,
      }),
    ).toBeUndefined();
  });

  it("refuses the measurement when there is no prefix to compare against", () => {
    expect(
      measuredInputTokens(base, {
        historyLength: 2,
        prefixKey: undefined,
        tailTokens: 0,
      }),
    ).toBeUndefined();
  });

  it("refuses the measurement when the history got shorter", () => {
    expect(
      measuredInputTokens(base, {
        historyLength: 1,
        prefixKey: "prefix-a",
        tailTokens: 0,
      }),
    ).toBeUndefined();
  });
});

describe("the measured request store", () => {
  beforeEach(() => {
    clearMeasuredRequests();
  });

  it("keeps one prefix's measurement away from another", () => {
    recordMeasuredRequest("prefix-a", base);

    expect(measuredRequestFor("prefix-a")).toEqual(base);
    expect(measuredRequestFor("prefix-b")).toBeUndefined();
    expect(measuredRequestFor(undefined)).toBeUndefined();
  });

  it("replaces the record when a new request is measured", () => {
    recordMeasuredRequest("prefix-a", base);
    recordMeasuredRequest("prefix-a", { ...base, promptTokens: 1500 });

    expect(measuredRequestFor("prefix-a")?.promptTokens).toBe(1500);
  });

  it("forgets the oldest record once it is full", () => {
    // A server outlives any number of sessions, and each one's prefix is a key.
    for (let i = 0; i < 33; i++) {
      recordMeasuredRequest(`prefix-${i}`, {
        ...base,
        prefixKey: `prefix-${i}`,
      });
    }

    expect(measuredRequestFor("prefix-0")).toBeUndefined();
    expect(measuredRequestFor("prefix-32")).toEqual({
      ...base,
      prefixKey: "prefix-32",
    });
  });
});

describe("noteMeasuredRequest", () => {
  beforeEach(() => {
    clearMeasuredRequests();
  });

  it("records what the provider reported for the request that was sent", () => {
    noteMeasuredRequest(
      "prefix-a",
      { promptTokens: 777 },
      { historyLength: 6 },
    );

    expect(measuredRequestFor("prefix-a")).toEqual({
      promptTokens: 777,
      historyLength: 6,
      prefixKey: "prefix-a",
    });
  });

  it("records nothing when the provider reported no usage", () => {
    // A dialect that sends no usage is not a request that cost nothing: recording
    // zero would postpone compaction until the provider refuses the request.
    noteMeasuredRequest("prefix-a", {}, { historyLength: 3 });

    expect(measuredRequestFor("prefix-a")).toBeUndefined();
  });

  it("records nothing when there is no prefix to find the record under", () => {
    noteMeasuredRequest(undefined, { promptTokens: 500 }, { historyLength: 3 });

    expect(measuredRequestFor(undefined)).toBeUndefined();
  });
});
