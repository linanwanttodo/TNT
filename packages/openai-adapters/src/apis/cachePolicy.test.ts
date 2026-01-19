import { afterEach, describe, expect, it, vi } from "vitest";

import { cacheRetention, resolveCachePolicy } from "./cachePolicy.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cacheRetention", () => {
  it("defaults to short and accepts only the two long modes", () => {
    expect(cacheRetention(undefined)).toBe("short");
    expect(cacheRetention("")).toBe("short");
    expect(cacheRetention(" LONG ")).toBe("long");
    expect(cacheRetention("none")).toBe("none");
    expect(cacheRetention("nonsense")).toBe("short");
  });

  it("reads the environment when no argument is given", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    expect(cacheRetention()).toBe("long");
  });
});

describe("resolveCachePolicy", () => {
  it("gives Anthropic explicit breakpoints and a one-hour long mode", () => {
    const short = resolveCachePolicy("anthropic", "claude-sonnet");
    expect(short).toMatchObject({
      mode: "explicit",
      retention: "short",
      ttlMs: 5 * MINUTE,
      maxBreakpoints: 4,
      supportsLongRetention: true,
    });

    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    expect(resolveCachePolicy("anthropic", "claude-sonnet").ttlMs).toBe(HOUR);
  });

  it("keeps DeepSeek's implicit cache long-lived in both modes", () => {
    const policy = resolveCachePolicy("deepseek", "deepseek-reasoner");
    expect(policy.mode).toBe("implicit");
    expect(policy.ttlMs).toBe(24 * HOUR);
    expect(policy.maxBreakpoints).toBe(0);

    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    expect(resolveCachePolicy("deepseek", "deepseek-chat").ttlMs).toBe(
      24 * HOUR,
    );
  });

  it("treats a DeepSeek Anthropic endpoint as DeepSeek", () => {
    const policy = resolveCachePolicy(
      "anthropic",
      "claude-sonnet",
      "https://api.deepseek.com/anthropic",
    );
    expect(policy.mode).toBe("implicit");
    expect(policy.ttlMs).toBe(24 * HOUR);
  });

  it("gives GPT-5.6 and later explicit breakpoints; earlier models stay implicit", () => {
    const explicit = resolveCachePolicy("openai", "gpt-5.6-sol");
    expect(explicit.mode).toBe("explicit");
    expect(explicit.ttlMs).toBe(30 * MINUTE);
    expect(explicit.maxBreakpoints).toBe(4);

    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    expect(resolveCachePolicy("openai", "gpt-6.1-sol").ttlMs).toBe(12 * HOUR);

    const implicit = resolveCachePolicy("openai", "gpt-4o");
    expect(implicit.mode).toBe("implicit");
    expect(implicit.maxBreakpoints).toBe(0);
    expect(implicit.ttlMs).toBe(30 * MINUTE);
  });

  it("gives Moonshot a two-step TTL and Gemini implicit caching", () => {
    const moonshot = resolveCachePolicy("moonshot", "kimi-k3");
    expect(moonshot.ttlMs).toBe(5 * MINUTE);
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");
    expect(resolveCachePolicy("moonshot", "kimi-k3").ttlMs).toBe(HOUR);

    expect(resolveCachePolicy("gemini", "gemini-4-pro")).toMatchObject({
      mode: "implicit",
      ttlMs: 5 * MINUTE,
      minTokens: 2048,
    });
  });

  it("knows which providers have no prompt cache to preserve", () => {
    for (const provider of ["ollama", "lmstudio", "vllm"]) {
      expect(resolveCachePolicy(provider, "local-model").mode, provider).toBe(
        "none",
      );
    }
  });

  it("turns every provider off when retention is none", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "none");
    for (const provider of ["anthropic", "openai", "deepseek", "moonshot"]) {
      const policy = resolveCachePolicy(provider, "any-model");
      expect(policy.mode, provider).toBe("none");
      expect(policy.ttlMs, provider).toBe(0);
      expect(policy.maxBreakpoints, provider).toBe(0);
    }
  });
});
