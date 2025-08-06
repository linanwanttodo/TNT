import { beforeEach, describe, expect, it } from "vitest";

import {
  attributeCacheMiss,
  cachePrefixKeys,
  classifyCachePrefix,
  COMPACTION_PREFIX_STATE,
  COLD_PREFIX_STATE,
  forgetCachePrefixes,
  HISTORY_REWRITTEN,
  MIN_CACHEABLE_PREFIX_TOKENS,
  recallCachePrefix,
  rememberCachePrefix,
  serializeCachePrefix,
} from "./prefixState.js";
import type { RequestHeader } from "./requestHeader.js";

const base: RequestHeader = {
  model: "deepseek-chat",
  systemMessage: "base prompt",
  tools: [{ function: { name: "Read" } }],
  temperature: 0,
  mode: "agent",
};

describe("classifyCachePrefix", () => {
  it("reports no verdict without a previous request", () => {
    expect(classifyCachePrefix(undefined, base)).toBeUndefined();
  });

  it("calls an identical prefix full", () => {
    expect(classifyCachePrefix({ ...base }, { ...base })).toEqual({
      state: "full",
      reasons: [],
    });
  });

  it("treats an empty tool list as the same as a missing one", () => {
    expect(
      classifyCachePrefix(
        { ...base, tools: [] },
        { ...base, tools: undefined },
      ),
    ).toEqual({ state: "full", reasons: [] });
  });

  it("calls a newly appended system update a passthrough", () => {
    expect(
      classifyCachePrefix(
        { ...base, systemMessageUpdates: ["rule one"] },
        { ...base, systemMessageUpdates: ["rule one", "rule two"] },
      ),
    ).toEqual({
      state: "passthrough",
      reasons: ["appended:systemMessageUpdates"],
    });
  });

  it("calls a newly appended tool a passthrough", () => {
    expect(
      classifyCachePrefix(base, {
        ...base,
        tools: [{ function: { name: "Read" } }, { function: { name: "Edit" } }],
      }),
    ).toEqual({ state: "passthrough", reasons: ["appended:tools"] });
  });

  it("blames the system message when it was rewritten", () => {
    expect(
      classifyCachePrefix(base, { ...base, systemMessage: "base prompt v2" }),
    ).toEqual({ state: "invalidated", reasons: ["systemMessage"] });
  });

  it("blames the tool list when a tool was reordered", () => {
    const twoTools: RequestHeader = {
      ...base,
      tools: [{ function: { name: "Read" } }, { function: { name: "Edit" } }],
    };

    expect(
      classifyCachePrefix(twoTools, {
        ...base,
        tools: [{ function: { name: "Edit" } }, { function: { name: "Read" } }],
      }),
    ).toEqual({ state: "invalidated", reasons: ["tools"] });
  });

  it("blames the tool list when a tool was dropped", () => {
    const twoTools: RequestHeader = {
      ...base,
      tools: [{ function: { name: "Read" } }, { function: { name: "Edit" } }],
    };

    expect(classifyCachePrefix(twoTools, base)).toEqual({
      state: "invalidated",
      reasons: ["tools"],
    });
  });

  it("blames the mode when the permission mode moved", () => {
    expect(classifyCachePrefix(base, { ...base, mode: "plan" })).toEqual({
      state: "invalidated",
      reasons: ["mode"],
    });
  });

  it("names every field that moved", () => {
    expect(
      classifyCachePrefix(base, {
        ...base,
        model: "deepseek-reasoner",
        mode: "plan",
      }),
    ).toEqual({ state: "invalidated", reasons: ["model", "mode"] });
  });

  it("reports nothing when neither a previous request nor a rewrite exists", () => {
    expect(
      classifyCachePrefix(undefined, base, { historyRewritten: false }),
    ).toBeUndefined();
  });

  it("blames a rewritten history even without a previous request", () => {
    expect(
      classifyCachePrefix(undefined, base, { historyRewritten: true }),
    ).toEqual({ state: "invalidated", reasons: [HISTORY_REWRITTEN] });
  });

  it("blames the rewrite on top of an otherwise identical prefix", () => {
    expect(
      classifyCachePrefix(
        { ...base },
        { ...base },
        {
          historyRewritten: true,
        },
      ),
    ).toEqual({ state: "invalidated", reasons: [HISTORY_REWRITTEN] });
  });

  it("keeps both reasons when the prefix moved and the history was rewritten", () => {
    expect(
      classifyCachePrefix(
        base,
        { ...base, mode: "plan" },
        {
          historyRewritten: true,
        },
      ),
    ).toEqual({
      state: "invalidated",
      reasons: ["mode", HISTORY_REWRITTEN],
    });
  });
});

describe("serializeCachePrefix", () => {
  it("keeps nested tool fields instead of collapsing them", () => {
    const read = serializeCachePrefix({
      model: "m",
      tools: [{ function: { name: "Read" } }],
    });
    const edit = serializeCachePrefix({
      model: "m",
      tools: [{ function: { name: "Edit" } }],
    });

    expect(read).not.toBe(edit);
  });

  it("is stable for the same prefix built twice", () => {
    expect(serializeCachePrefix(base)).toBe(serializeCachePrefix({ ...base }));
  });
});

describe("cachePrefixKeys", () => {
  it("gives stable short hashes for the prefix and its halves", () => {
    const first = cachePrefixKeys(base);
    const second = cachePrefixKeys({ ...base });

    expect(first).toEqual(second);
    expect(first.prefix).toHaveLength(12);
    expect(first.system).toHaveLength(12);
    expect(first.tools).toHaveLength(12);
  });

  it("changes the system hash only when the system block moved", () => {
    const before = cachePrefixKeys(base);
    const after = cachePrefixKeys({
      ...base,
      tools: [{ function: { name: "Edit" } }],
    });

    expect(after.system).toBe(before.system);
    expect(after.tools).not.toBe(before.tools);
  });
});

describe("cache prefix memory", () => {
  beforeEach(() => forgetCachePrefixes());

  it("returns what was remembered for a scope", () => {
    rememberCachePrefix("tnt-a", base);
    expect(recallCachePrefix("tnt-a")).toEqual(base);
  });

  it("keeps scopes apart", () => {
    rememberCachePrefix("tnt-a", base);
    expect(recallCachePrefix("tnt-b")).toBeUndefined();
  });

  it("shares one slot for a missing scope", () => {
    rememberCachePrefix(undefined, base);
    expect(recallCachePrefix(undefined)).toEqual(base);
  });
});

describe("attributeCacheMiss", () => {
  const longEnough = MIN_CACHEABLE_PREFIX_TOKENS;

  it("says nothing when the cache was read", () => {
    expect(
      attributeCacheMiss({
        verdict: { state: "full", reasons: [] },
        cacheReadTokens: 400,
        inputTokens: 2000,
      }),
    ).toBeUndefined();
  });

  it("says nothing below the cacheable prefix length", () => {
    expect(
      attributeCacheMiss({
        verdict: { state: "full", reasons: [] },
        cacheReadTokens: 0,
        inputTokens: longEnough - 1,
      }),
    ).toBeUndefined();
  });

  it("says nothing without a verdict", () => {
    expect(
      attributeCacheMiss({ cacheReadTokens: 0, inputTokens: 5000 }),
    ).toBeUndefined();
  });

  it("keeps the labels for a first request and a compaction request apart", () => {
    expect(COLD_PREFIX_STATE).toBe("cold");
    expect(COMPACTION_PREFIX_STATE).toBe("compaction");
  });

  it("blames the provider for a miss on an identical prefix", () => {
    expect(
      attributeCacheMiss({
        verdict: { state: "full", reasons: [] },
        cacheReadTokens: 0,
        inputTokens: longEnough,
      }),
    ).toBe("provider");
  });

  it("blames the prefix when it was invalidated", () => {
    expect(
      attributeCacheMiss({
        verdict: { state: "invalidated", reasons: ["systemMessage"] },
        cacheReadTokens: 0,
        inputTokens: longEnough,
      }),
    ).toBe("prefix");
  });
});
