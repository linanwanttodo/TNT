import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OLLAMA_CONTEXT_LENGTH,
  OllamaApi,
  extractOllamaContextLength,
  fetchOllamaContextLength,
  ollamaShowUrl,
} from "./Ollama.js";

const showResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
  }) as Response;

describe("ollamaShowUrl", () => {
  it("strips the OpenAI-compatible /v1 suffix back to the server root", () => {
    expect(ollamaShowUrl("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/api/show",
    );
    expect(ollamaShowUrl("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/api/show",
    );
    expect(ollamaShowUrl(undefined)).toBe("http://localhost:11434/api/show");
  });
});

describe("extractOllamaContextLength", () => {
  it("reads num_ctx from model_info", () => {
    expect(extractOllamaContextLength({ model_info: { num_ctx: 16384 } })).toBe(
      16384,
    );
  });

  it("reads the architecture's context_length key", () => {
    expect(
      extractOllamaContextLength({
        model_info: { "llama.context_length": 131072 },
      }),
    ).toBe(131072);
  });

  it("reads a num_ctx override out of parameters", () => {
    expect(
      extractOllamaContextLength({
        model_info: {},
        parameters: "stop <|im_end|>\nnum_ctx 4096",
      }),
    ).toBe(4096);
  });

  it("returns null when no window is reported", () => {
    expect(extractOllamaContextLength({ model_info: {} })).toBeNull();
    expect(extractOllamaContextLength(undefined)).toBeNull();
    expect(extractOllamaContextLength("nope")).toBeNull();
  });
});

describe("fetchOllamaContextLength", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the window the server reports", async () => {
    const fetchMock = vi.fn(async () =>
      showResponse({ model_info: { num_ctx: 16384 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchOllamaContextLength("http://localhost:11434/v1", "qwen3"),
    ).toBe(16384);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/show",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null on a 404 without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => showResponse("model not found", false)),
    );

    expect(
      await fetchOllamaContextLength("http://localhost:11434/v1", "nope"),
    ).toBeNull();
  });

  it("returns null when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    expect(await fetchOllamaContextLength(undefined, "qwen3")).toBeNull();
  });

  it("keeps the 8192 floor distinct from the 200k generic default", () => {
    expect(DEFAULT_OLLAMA_CONTEXT_LENGTH).toBe(8192);
  });
});

describe("OllamaApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the window discovered before the first request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => showResponse({ model_info: { num_ctx: 16384 } })),
    );

    const api = new OllamaApi({
      provider: "ollama",
      apiBase: "http://localhost:11434/v1",
      model: "qwen3",
    } as any);

    expect(await api.discoverContextLength()).toBe(16384);
  });

  it("reports null when the probe fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const api = new OllamaApi({
      provider: "ollama",
      apiBase: "http://localhost:11434/v1",
      model: "qwen3",
    } as any);

    expect(await api.discoverContextLength()).toBeNull();
  });
});
