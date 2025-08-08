import { describe, expect, it, vi } from "vitest";

import {
  currentPromptCacheKey,
  promptCacheKeyForSession,
} from "./promptCacheKey.js";

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => {
    throw new Error("Session not available");
  }),
}));

vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("promptCacheKeyForSession", () => {
  it("keys a top-level conversation by its own session", () => {
    expect(promptCacheKeyForSession({ sessionId: "abc" })).toBe("tnt-abc");
  });

  it("makes a delegated run share its parent's cache", () => {
    expect(
      promptCacheKeyForSession({
        sessionId: "abc:1",
        parentSessionId: "abc",
      }),
    ).toBe("tnt-abc");
  });
});

describe("currentPromptCacheKey", () => {
  it("returns undefined when no session is open", () => {
    expect(currentPromptCacheKey()).toBeUndefined();
  });
});
