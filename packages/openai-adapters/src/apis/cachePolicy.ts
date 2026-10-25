/**
 * How each provider's prompt cache is reached, and how long it lives.
 *
 * The client has three kinds of relationship with a provider cache:
 *
 * - `explicit`: the request places cache markers and may choose a TTL.
 * - `implicit`: the provider caches a stable prefix on its own; the client's
 *   only lever is keeping those bytes identical, and the TTL tells it when a
 *   refresh is not worth preserving.
 * - `none`: no cache to preserve.
 *
 * The TTL is the provider's estimate, not a guarantee. It is used to decide
 * when old context is worth pruning and how long a background wait may run
 * before the next request pays a cold prefix.
 */
export type CacheRetention = "short" | "long" | "none";
export type CacheMode = "explicit" | "implicit" | "none";

export interface CachePolicy {
  retention: CacheRetention;
  mode: CacheMode;
  /** The provider-side lifetime selected by the retention mode; 0 when none. */
  ttlMs: number;
  /** Markers the provider reads; 0 for implicit caching. */
  maxBreakpoints: number;
  /** Shortest prefix the provider is willing to cache. */
  minTokens: number;
  /** Whether `long` selects a different TTL for this provider. */
  supportsLongRetention: boolean;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const SHORT_TTL_MS = 5 * MINUTE;
const OPENAI_SHORT_TTL_MS = 30 * MINUTE;
const OPENAI_LONG_TTL_MS = 12 * HOUR;
const DEEPSEEK_TTL_MS = 24 * HOUR;

/**
 * `short` is the default because it is the mode with the least write cost.
 * `long` is for a session whose requests are spaced further apart than the
 * short window; `none` is for a provider whose cache should not be used at all.
 */
export function cacheRetention(
  raw = process.env.CONTINUE_CLI_CACHE_RETENTION,
): CacheRetention {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "long" || value === "none" ? value : "short";
}

/** GPT-5.6 and later are the models that read explicit breakpoints. */
function supportsExplicitBreakpoints(modelName: string | undefined): boolean {
  const match = /gpt-(\d+)(?:\.(\d+))?/i.exec(modelName ?? "");
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 6);
}

function policy(
  retention: CacheRetention,
  mode: CacheMode,
  shortTtlMs: number,
  longTtlMs: number,
  maxBreakpoints: number,
  minTokens: number,
): CachePolicy {
  const supportsLongRetention = longTtlMs !== shortTtlMs;
  return {
    retention,
    mode,
    ttlMs:
      retention === "none"
        ? 0
        : retention === "long" && supportsLongRetention
          ? longTtlMs
          : shortTtlMs,
    maxBreakpoints: retention === "none" ? 0 : maxBreakpoints,
    minTokens,
    supportsLongRetention,
  };
}

export function resolveCachePolicy(
  provider?: string,
  modelName?: string,
  baseUrl?: string,
): CachePolicy {
  const retention = cacheRetention();
  const hint =
    `${provider ?? ""} ${modelName ?? ""} ${baseUrl ?? ""}`.toLowerCase();

  if (retention === "none") {
    return policy("none", "none", 0, 0, 0, 0);
  }

  // The provider name wins over a model name that mentions another vendor's
  // family: a Bedrock model id carries "claude" or "nova" but bills and caches
  // through Bedrock's own cache points.
  const providerName = (provider ?? "").trim().toLowerCase();
  if (providerName === "bedrock") {
    return policy(retention, "explicit", SHORT_TTL_MS, HOUR, 4, 1024);
  }

  // Checked before Anthropic because a DeepSeek Anthropic-compatible endpoint
  // names both providers, and its cache is the long-lived implicit one.
  if (hint.includes("deepseek")) {
    return policy(
      retention,
      "implicit",
      DEEPSEEK_TTL_MS,
      DEEPSEEK_TTL_MS,
      0,
      1024,
    );
  }

  if (hint.includes("anthropic") || hint.includes("claude")) {
    return policy(retention, "explicit", SHORT_TTL_MS, HOUR, 4, 1024);
  }

  if (
    hint.includes("openai") ||
    hint.includes("gpt") ||
    hint.includes("codex")
  ) {
    const explicit = supportsExplicitBreakpoints(modelName);
    return policy(
      retention,
      explicit ? "explicit" : "implicit",
      OPENAI_SHORT_TTL_MS,
      explicit ? OPENAI_LONG_TTL_MS : OPENAI_SHORT_TTL_MS,
      explicit ? 4 : 0,
      explicit ? 1024 : 2048,
    );
  }

  if (hint.includes("moonshot") || hint.includes("kimi")) {
    return policy(retention, "implicit", SHORT_TTL_MS, HOUR, 0, 1024);
  }

  if (hint.includes("gemini") || hint.includes("vertex")) {
    return policy(retention, "implicit", SHORT_TTL_MS, SHORT_TTL_MS, 0, 2048);
  }

  if (hint.includes("bedrock")) {
    return policy(retention, "explicit", SHORT_TTL_MS, HOUR, 4, 1024);
  }

  if (hint.includes("dashscope") || hint.includes("qwen")) {
    return policy(retention, "explicit", SHORT_TTL_MS, SHORT_TTL_MS, 4, 1024);
  }

  if (
    hint.includes("zai") ||
    hint.includes("glm") ||
    hint.includes("bigmodel")
  ) {
    return policy(retention, "implicit", SHORT_TTL_MS, SHORT_TTL_MS, 0, 1024);
  }

  if (
    hint.includes("ollama") ||
    hint.includes("llama.cpp") ||
    hint.includes("llamafile") ||
    hint.includes("lmstudio") ||
    hint.includes("vllm") ||
    hint.includes("text-gen-webui")
  ) {
    return policy("none", "none", 0, 0, 0, 0);
  }

  // An unknown provider may still cache; keeping the prefix stable is free,
  // and the conservative five-minute TTL is the safe pruning default.
  return policy(retention, "implicit", SHORT_TTL_MS, SHORT_TTL_MS, 0, 1024);
}
