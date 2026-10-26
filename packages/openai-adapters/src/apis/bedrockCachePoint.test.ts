import { afterEach, describe, expect, it, vi } from "vitest";

import { BedrockApi } from "./Bedrock.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function convert(model: string, withTools = true) {
  const api = new BedrockApi({ apiKey: "test-key" } as any) as any;
  return api._convertBody({
    model,
    messages: [
      { role: "system", content: "stable instructions" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "newest question" },
    ],
    ...(withTools
      ? {
          tools: [
            {
              type: "function",
              function: {
                name: "Read",
                description: "read a file",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        }
      : {}),
  } as any);
}

function cachePoints(body: any): any[] {
  const found: any[] = [];
  const walk = (value: any): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object" && value !== null) {
      if (value.cachePoint) {
        found.push(value.cachePoint);
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(body);
  return found;
}

describe("Bedrock cache points", () => {
  it("marks the system head, the tool list and the newest turn", () => {
    const body = convert("anthropic.claude-sonnet-4-5-20250929-v1:0");
    const points = cachePoints(body);

    expect(points).toHaveLength(3);
    expect(points.every((point) => point.ttl === "5m")).toBe(true);
    expect(body.system.at(-1).cachePoint).toBeDefined();
    expect(body.toolConfig.tools.at(-1).cachePoint).toBeDefined();
    expect(body.messages.at(-1).content.at(-1).cachePoint).toBeDefined();
  });

  it("asks for the extended ttl on a model that supports it", () => {
    vi.stubEnv("TNT_CACHE_RETENTION", "long");

    const body = convert("anthropic.claude-opus-4-5-20251101-v1:0");
    const points = cachePoints(body);

    expect(points).toHaveLength(3);
    expect(points.every((point) => point.ttl === "1h")).toBe(true);
  });

  it("keeps the five-minute ttl on a model without extended retention", () => {
    vi.stubEnv("TNT_CACHE_RETENTION", "long");

    const body = convert("anthropic.claude-3-7-sonnet-20250219-v1:0");
    const points = cachePoints(body);

    expect(points).toHaveLength(3);
    expect(points.every((point) => point.ttl === "5m")).toBe(true);
  });

  it("sends no cache points when retention is none", () => {
    vi.stubEnv("TNT_CACHE_RETENTION", "none");

    expect(cachePoints(convert("anthropic.claude-sonnet-4-5"))).toEqual([]);
  });

  it("leaves a model without cache-point support untouched", () => {
    expect(cachePoints(convert("meta.llama3-70b-instruct-v1:0"))).toEqual([]);
  });

  it("drops the tool point when the request has no tools", () => {
    const body = convert("amazon.nova-pro-v1:0", false);

    expect(cachePoints(body)).toHaveLength(2);
    expect(body.toolConfig).toBeUndefined();
  });
});
