import { beforeEach, describe, expect, it } from "vitest";

import {
  cacheStateText,
  forgetLastRequestCacheState,
  getLastRequestCacheState,
  rememberLastRequestCacheState,
} from "./lastRequestCacheState.js";

const labels = {
  states: {
    full: "cached",
    passthrough: "extended",
    invalidated: "moved",
  },
  prefix: "Prefix",
};

/**
 * The status bar shows the session-wide hit ratio, which is an average and cannot
 * tell a user why the round they just waited for was slow. This holds the last
 * request's verdict so the line can say it, and stays silent while the prefix
 * holds - a note every turn is a note nobody reads.
 */
describe("the last request's cache state", () => {
  beforeEach(() => {
    forgetLastRequestCacheState();
  });

  it("holds what it was given and gives it back", () => {
    rememberLastRequestCacheState({
      state: "invalidated",
      reasons: ["systemMessage"],
      hitRate: 0.2,
      reportPath: "/tmp/cache-breaks/session/one.json",
    });

    expect(getLastRequestCacheState()).toEqual({
      state: "invalidated",
      reasons: ["systemMessage"],
      hitRate: 0.2,
      reportPath: "/tmp/cache-breaks/session/one.json",
    });
  });

  it("says nothing while the prefix holds", () => {
    rememberLastRequestCacheState({
      state: "full",
      reasons: [],
      hitRate: 0.95,
    });

    expect(cacheStateText(getLastRequestCacheState(), labels)).toBeUndefined();
  });

  it("names the state and the fields that moved when it does not", () => {
    rememberLastRequestCacheState({
      state: "invalidated",
      reasons: ["tools", "systemMessage"],
      hitRate: 0.1,
    });

    expect(cacheStateText(getLastRequestCacheState(), labels)).toBe(
      "Prefix moved: tools, systemMessage",
    );
  });

  it("names an extension as one, without reasons to list", () => {
    rememberLastRequestCacheState({
      state: "passthrough",
      reasons: ["appended:tools"],
      hitRate: 0.8,
    });

    expect(cacheStateText(getLastRequestCacheState(), labels)).toBe(
      "Prefix extended: appended:tools",
    );
  });

  it("says nothing before any request has run", () => {
    expect(getLastRequestCacheState()).toBeUndefined();
    expect(cacheStateText(getLastRequestCacheState(), labels)).toBeUndefined();
  });

  it("falls back to the raw state when a label is missing", () => {
    // A state added to the type without a translation must not render as
    // undefined in the middle of the status line.
    rememberLastRequestCacheState({
      state: "passthrough",
      reasons: [],
      hitRate: 0.5,
    });

    const text = cacheStateText(getLastRequestCacheState(), {
      states: { full: "cached" } as any,
      prefix: "Prefix",
    });

    expect(text).toBe("Prefix passthrough");
  });
});
