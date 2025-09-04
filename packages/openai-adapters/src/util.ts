import { RequestOptions } from "@tnt/config-types";
import { fetchwithRequestOptions, patchedFetch } from "@tnt/fetch";
import {
  ChatCompletionChunk,
  CompletionUsage,
  CreateEmbeddingResponse,
  Model,
} from "openai/resources/index";

import { ChatCompletion } from "openai/resources/index.js";
import { CreateRerankResponse } from "./apis/base.js";

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function firstCount(values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = count(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function nested(source: unknown, key: string): Record<string, unknown> {
  const value =
    typeof source === "object" && source !== null
      ? (source as Record<string, unknown>)[key]
      : undefined;
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function at(source: Record<string, unknown>, keys: string[]): unknown[] {
  return keys.map((key) => source[key]);
}

/**
 * The OpenAI field names every provider's counts are folded into, plus the two
 * cache spellings the engine and the telemetry read. `cache_read_tokens` is not in
 * the SDK type, so callers that only know OpenAI keep working and the ones that
 * meter caching get a number instead of undefined.
 */
export type NormalizedUsage = CompletionUsage & {
  prompt_tokens_details?: CompletionUsage["prompt_tokens_details"] & {
    cached_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
};

/**
 * Providers write their token counts differently, and until now the engine, the
 * cost calculation and the cache telemetry each read one spelling - so a Gemini
 * or an OpenAI-Responses cache hit looked like a miss. This folds every dialect
 * into the OpenAI names the rest of the code already speaks, and leaves a field
 * out when no dialect reported it, so a caller's own estimate is not overwritten
 * by a zero the provider never sent.
 */
export function normalizeUsage(usage: unknown): NormalizedUsage | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const raw = usage as Record<string, unknown>;
  const promptDetails = {
    ...nested(raw, "prompt_tokens_details"),
    ...nested(raw, "input_tokens_details"),
    ...nested(raw, "inputTokenDetails"),
  };
  const completionDetails = {
    ...nested(raw, "completion_tokens_details"),
    ...nested(raw, "output_tokens_details"),
    ...nested(raw, "outputTokenDetails"),
  };

  const promptTokens = firstCount([
    ...at(raw, [
      "prompt_tokens",
      "input_tokens",
      "promptTokenCount",
      "inputTokens",
      "prompt_eval_count",
    ]),
    ...at(promptDetails, ["input_tokens"]),
  ]);
  const completionTokens = firstCount([
    ...at(raw, [
      "completion_tokens",
      "output_tokens",
      "candidatesTokenCount",
      "outputTokens",
      "generationTokenCount",
      "eval_count",
    ]),
    ...at(completionDetails, ["output_tokens"]),
  ]);
  const totalTokens =
    firstCount(at(raw, ["total_tokens", "totalTokenCount", "totalTokens"])) ??
    (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined);

  const cachedTokens = firstCount([
    ...at(promptDetails, [
      "cache_read_tokens",
      "cached_tokens",
      "cacheReadTokens",
      "cached_input_tokens",
    ]),
    ...at(raw, [
      "cache_read_tokens",
      "cached_tokens",
      "cache_read_input_tokens",
      "cacheReadTokens",
      "cachedContentTokenCount",
    ]),
  ]);
  const cacheWriteTokens = firstCount([
    ...at(promptDetails, [
      "cache_write_tokens",
      "cacheWriteTokens",
      "cache_creation_tokens",
    ]),
    ...at(raw, [
      "cache_write_tokens",
      "cacheWriteTokens",
      "cache_creation_input_tokens",
      "cache_creation_tokens",
    ]),
  ]);
  const reasoningTokens = firstCount([
    ...at(completionDetails, ["reasoning_tokens", "reasoningTokens"]),
    ...at(raw, ["reasoning_tokens", "reasoningTokens", "thoughtsTokenCount"]),
  ]);

  const normalized: Record<string, unknown> = {};
  if (promptTokens !== undefined) normalized.prompt_tokens = promptTokens;
  if (completionTokens !== undefined) {
    normalized.completion_tokens = completionTokens;
  }
  if (totalTokens !== undefined) normalized.total_tokens = totalTokens;
  if (cachedTokens !== undefined || cacheWriteTokens !== undefined) {
    normalized.prompt_tokens_details = {
      ...(cachedTokens !== undefined
        ? { cached_tokens: cachedTokens, cache_read_tokens: cachedTokens }
        : {}),
      ...(cacheWriteTokens !== undefined
        ? { cache_write_tokens: cacheWriteTokens }
        : {}),
    };
  }
  if (reasoningTokens !== undefined) {
    normalized.completion_tokens_details = {
      reasoning_tokens: reasoningTokens,
    };
  }

  return Object.keys(normalized).length === 0
    ? undefined
    : (normalized as unknown as NormalizedUsage);
}

export function chatChunk(options: {
  content: string | null | undefined;
  model: string;
  finish_reason?: ChatCompletionChunk.Choice["finish_reason"];
  id?: string | null;
  usage?: CompletionUsage;
}): ChatCompletionChunk {
  return {
    choices: [
      {
        delta: {
          content: options.content,
          role: "assistant",
        },
        finish_reason: options.finish_reason ?? "stop",
        index: 0,
        logprobs: null,
      },
    ],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion.chunk",
  };
}

export function usageChatChunk(options: {
  model: string;
  id?: string | null;
  usage?: CompletionUsage;
}): ChatCompletionChunk {
  return {
    choices: [],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion.chunk",
  };
}

export function chatChunkFromDelta(options: {
  delta: ChatCompletionChunk.Choice["delta"];
  model: string;
  finish_reason?: ChatCompletionChunk.Choice["finish_reason"];
  id?: string | null;
  usage?: CompletionUsage;
}): ChatCompletionChunk {
  return {
    choices: [
      {
        delta: options.delta,
        finish_reason: options.finish_reason ?? "stop",
        index: 0,
        logprobs: null,
      },
    ],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion.chunk",
  };
}

export function chatCompletion(options: {
  content: string | null | undefined;
  model: string;
  finish_reason?: ChatCompletion.Choice["finish_reason"];
  id?: string | null;
  usage?: CompletionUsage;
  index?: number | null;
}): ChatCompletion {
  return {
    choices: [
      {
        finish_reason: options.finish_reason ?? "stop",
        index: options.index ?? 0,
        logprobs: null,
        message: {
          content: options.content ?? null,
          role: "assistant",
          refusal: null,
        },
      },
    ],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion",
  };
}

export function embedding(options: {
  data: number[][];
  model: string;
  usage?: CreateEmbeddingResponse.Usage;
}): CreateEmbeddingResponse {
  return {
    data: options.data.map((embedding, i) => ({
      index: i,
      embedding: embedding,
      object: "embedding" as const,
    })),
    model: options.model,
    object: "list" as const,
    usage: options.usage ?? {
      prompt_tokens: 0,
      total_tokens: 0,
    },
  };
}

export function rerank(options: {
  model: string;
  data: number[];
  usage?: CreateRerankResponse["usage"];
}): CreateRerankResponse {
  return {
    data: options.data.map((score, index) => ({
      index,
      relevance_score: score,
    })),
    model: options.model,
    object: "list" as const,
    usage: options.usage ?? {
      total_tokens: 0,
    },
  };
}

export function model(options: { id: string; owned_by?: string }): Model {
  return {
    id: options.id,
    object: "model",
    created: Date.now(),
    owned_by: options.owned_by ?? "organization-owner",
  };
}

export function customFetch(
  requestOptions: RequestOptions | undefined,
): typeof patchedFetch {
  if (process.env.FEATURE_FLAG_DISABLE_CUSTOM_FETCH) {
    return patchedFetch;
  }

  function letRequestOptionsOverrideAuthHeaders(init: any): any {
    if (!init || !init.headers || !requestOptions || !requestOptions.headers) {
      return init;
    }

    // Check if custom Authorization or x-api-key headers are provided
    const hasCustomAuth =
      requestOptions.headers["Authorization"] ||
      requestOptions.headers["authorization"];
    const hasCustomXApiKey =
      requestOptions.headers["x-api-key"] ||
      requestOptions.headers["X-Api-Key"];

    // Remove default auth headers if custom ones are provided
    if (hasCustomAuth || hasCustomXApiKey) {
      if (init.headers instanceof Headers) {
        if (hasCustomAuth) {
          init.headers.delete("Authorization");
        }
        if (hasCustomXApiKey) {
          init.headers.delete("x-api-key");
        }
      } else if (Array.isArray(init.headers)) {
        init.headers = init.headers.filter((header: [string, string]) => {
          const headerLower = (header[0] ?? "").toLowerCase();
          if (hasCustomAuth && headerLower === "authorization") return false;
          if (hasCustomXApiKey && headerLower === "x-api-key") return false;
          return true;
        });
      } else if (typeof init.headers === "object") {
        if (hasCustomAuth) {
          delete init.headers["Authorization"];
          delete init.headers["authorization"];
        }
        if (hasCustomXApiKey) {
          delete init.headers["x-api-key"];
          delete init.headers["X-Api-Key"];
        }
      }
    }
    return init;
  }

  return (req: URL | string | Request, init?: any) => {
    init = letRequestOptionsOverrideAuthHeaders(init);
    if (typeof req === "string" || req instanceof URL) {
      return fetchwithRequestOptions(req, init, requestOptions);
    } else {
      return fetchwithRequestOptions(req.url, init, requestOptions);
    }
  };
}
