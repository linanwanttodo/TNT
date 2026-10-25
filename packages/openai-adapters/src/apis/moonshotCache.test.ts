import { afterEach, describe, expect, it, vi } from "vitest";

import { MoonshotApi } from "./Moonshot.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function api() {
  return new MoonshotApi({ apiKey: "test-key" } as any);
}

function chatBody(model: string) {
  return {
    model,
    messages: [{ role: "user" as const, content: "hello" }],
    stream: false,
  } as any;
}

describe("Moonshot cache options", () => {
  it("asks for a five-minute implicit cache by default", () => {
    const body = api().modifyChatBody(chatBody("kimi-k3.1-pro"));

    expect((body as any).prompt_cache_options).toEqual({
      mode: "implicit",
      ttl: "5m",
    });
  });

  it("asks for a one-hour cache in long mode", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");

    const body = api().modifyChatBody(chatBody("kimi-k3"));
    expect((body as any).prompt_cache_options).toEqual({
      mode: "implicit",
      ttl: "1h",
    });
  });

  it("leaves models that predate the option untouched", () => {
    const body = api().modifyChatBody(chatBody("kimi-k2.5"));
    expect((body as any).prompt_cache_options).toBeUndefined();
  });

  it("sends no options when retention is none", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "none");

    const body = api().modifyChatBody({
      ...chatBody("kimi-k3"),
      prompt_cache_options: { mode: "implicit", ttl: "1h" },
    });
    expect((body as any).prompt_cache_options).toBeUndefined();
  });
});
