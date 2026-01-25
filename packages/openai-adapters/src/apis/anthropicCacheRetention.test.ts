import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicApi } from "./Anthropic.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeApi(config: Record<string, unknown> = {}) {
  return new AnthropicApi({
    provider: "anthropic",
    apiKey: "test-key",
    cachingStrategy: "systemAndTools",
    ...config,
  } as any);
}

const request = {
  model: "claude-sonnet-4-20250514",
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Second question" },
  ],
};

function collectMarkers(value: unknown, found: any[] = []): any[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMarkers(item, found));
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "cache_control" && typeof child === "object" && child) {
        found.push(child);
      } else {
        collectMarkers(child, found);
      }
    }
  }
  return found;
}

function convert(api: AnthropicApi, body: unknown = request) {
  return (api as any)._convertBody(body);
}

describe("Anthropic cache retention", () => {
  it("keeps breakpoints on the provider default when retention is unset", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "");
    const markers = collectMarkers(convert(makeApi()));

    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker.type).toBe("ephemeral");
      expect(marker).not.toHaveProperty("ttl");
    }
  });

  it("extends every surviving breakpoint to one hour in long mode", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    const markers = collectMarkers(convert(makeApi()));

    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker).toEqual({ type: "ephemeral", ttl: "1h" });
    }
  });

  it("sends no breakpoints at all when retention is none", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "none");
    const api = makeApi();
    const body = convert(api);

    expect(collectMarkers(body)).toEqual([]);
    expect((api as any).getHeaders()["anthropic-beta"]).toBeUndefined();
  });

  it("does not extend breakpoints on an endpoint that reads none", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    const api = makeApi({ apiBase: "https://api.deepseek.com/anthropic" });
    const body = convert(api);

    expect(collectMarkers(body)).toEqual([]);
  });
});
