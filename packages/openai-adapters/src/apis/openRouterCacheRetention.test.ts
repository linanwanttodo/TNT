import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenRouterApi } from "./OpenRouter.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function api() {
  return new OpenRouterApi({
    provider: "openrouter",
    apiKey: "test-key",
    cachingStrategy: "systemAndTools",
  } as any);
}

function request() {
  return {
    model: "anthropic/claude-sonnet-4",
    messages: [
      { role: "system" as const, content: "stable instructions" },
      { role: "user" as const, content: "first question" },
      { role: "assistant" as const, content: "first answer" },
      { role: "user" as const, content: "newest question" },
    ],
    stream: false,
  } as any;
}

function markers(value: unknown, found: any[] = []): any[] {
  if (Array.isArray(value)) {
    value.forEach((item) => markers(item, found));
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "cache_control" && typeof child === "object" && child) {
        found.push(child);
      } else {
        markers(child, found);
      }
    }
  }
  return found;
}

describe("OpenRouter cache retention", () => {
  it("keeps the default five-minute markers", () => {
    const found = markers(api().modifyChatBody(request()));

    expect(found.length).toBeGreaterThan(0);
    for (const marker of found) {
      expect(marker).not.toHaveProperty("ttl");
    }
  });

  it("extends every marker in long mode", () => {
    vi.stubEnv("TNT_CACHE_RETENTION", "long");
    const found = markers(api().modifyChatBody(request()));

    expect(found.length).toBeGreaterThan(0);
    for (const marker of found) {
      expect(marker.ttl).toBe("1h");
    }
  });

  it("sends no markers when retention is none", () => {
    vi.stubEnv("TNT_CACHE_RETENTION", "none");

    expect(markers(api().modifyChatBody(request()))).toEqual([]);
  });
});
