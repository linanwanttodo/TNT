import { z } from "zod";

import { OpenAIConfigSchema } from "../types.js";
import { OpenAIApi } from "./OpenAI.js";

/**
 * Twice of https://github.com/ollama/ollama/blob/29ddfc2cab7f5a83a96c3133094f67b22e4f27d1/envconfig/config.go#L185
 * - the same floor core's Ollama LLM class assumes when the server answers
 * nothing. The 200k generic default would have an 8k-window local model
 * planning prompts four times over its real budget.
 */
export const DEFAULT_OLLAMA_CONTEXT_LENGTH = 8192;

/** How long the /api/show probe may take before the fallback wins. */
const OLLAMA_SHOW_TIMEOUT_MS = 3_000;

/**
 * The native /api/show endpoint lives on the server root. The OpenAI-compatible
 * surface appends /v1 to whatever the user wrote, so the root is recovered by
 * stripping that suffix again; an apiBase that never had it is used as-is.
 */
export function ollamaShowUrl(apiBase: string | undefined): string {
  const base = (apiBase ?? "http://localhost:11434/v1").replace(/\/+$/, "");
  const root = base.endsWith("/v1") ? base.slice(0, -3) : base;
  return `${root}/api/show`;
}

/**
 * Reads the context window out of a /api/show response. Real servers report it
 * under an architecture key (`llama.context_length`), some wrappers expose
 * `num_ctx` directly, and a server-side override shows up in `parameters`.
 */
export function extractOllamaContextLength(show: unknown): number | null {
  if (!show || typeof show !== "object") {
    return null;
  }
  const info = (show as { model_info?: unknown }).model_info;
  if (info && typeof info === "object") {
    const direct = (info as Record<string, unknown>).num_ctx;
    if (typeof direct === "number" && direct > 0) {
      return direct;
    }
    for (const [key, value] of Object.entries(info)) {
      if (
        /(^|\.)context_length$/.test(key) &&
        typeof value === "number" &&
        value > 0
      ) {
        return value;
      }
    }
  }
  const parameters = (show as { parameters?: unknown }).parameters;
  if (typeof parameters === "string") {
    const match = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(parameters);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Asks the Ollama server what context window the model runs with. Returns null
 * when the server is unreachable, slow, or answers without a window - the
 * caller falls back rather than guessing.
 */
export async function fetchOllamaContextLength(
  apiBase: string | undefined,
  model: string | undefined,
): Promise<number | null> {
  try {
    // /api/show is a POST that takes the model name; a GET is answered 405 by
    // the server, so despite the endpoint's read shape this has to be a POST.
    const response = await fetch(ollamaShowUrl(apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model ?? "" }),
      signal: AbortSignal.timeout(OLLAMA_SHOW_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    return extractOllamaContextLength(await response.json());
  } catch {
    return null;
  }
}

/**
 * The OpenAI-compatible surface for Ollama, plus the one thing the generic
 * wrapper cannot know: the context window the local server actually runs the
 * model with. The probe starts with the instance, so it is in flight before
 * the first request and its result is available to whoever builds the model
 * metadata (`discoverContextLength`).
 */
export class OllamaApi extends OpenAIApi {
  private contextLengthDiscovery: Promise<number | null>;

  // The wire schema does not carry the model id, but constructLlmApi hands the
  // full LLMConfig in and the probe needs the name to ask the server about.
  constructor(config: z.infer<typeof OpenAIConfigSchema> & { model?: string }) {
    super(config);
    this.contextLengthDiscovery = fetchOllamaContextLength(
      config.apiBase,
      config.model,
    );
  }

  /** The window the server reports, or null when the probe failed. */
  discoverContextLength(): Promise<number | null> {
    return this.contextLengthDiscovery;
  }
}
