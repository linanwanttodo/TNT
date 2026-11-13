import { beforeEach, describe, expect, test, vi } from "vitest";

const questionMock = vi.fn();

vi.mock("../utils/prompt.js", () => ({
  question: (...args: unknown[]) => questionMock(...args),
}));

import { fixtureKey } from "../../test-utils/fixtureCredentials.js";

import {
  PROTOCOLS,
  buildConfigYaml,
  fetchModelIds,
  mapProtocolToProvider,
  type ProviderSetup,
  runProviderSetup,
} from "./providerSetup.js";

describe("provider setup config generation", () => {
  const base: ProviderSetup = {
    protocol: "openai-chat-completions",
    apiBase: "https://api.openai.com/v1",
    apiKey: fixtureKey("test"),
    model: "gpt-4.1",
  };

  test("offers protocol families and common direct providers", () => {
    const ids = PROTOCOLS.map((protocol) => protocol.id);
    // The vendor presets are the core flow; the exact order is stable so the
    // protocol menu is predictable across runs.
    expect(ids).toEqual([
      "openai-chat-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
      "openai-compatible",
      "deepseek-global-preset",
      "zhipu-global-preset",
      "zhipu-cn-preset",
      "moonshot-cn-preset",
      "qwen-cn-preset",
      "siliconflow-cn-preset",
      "minimax-global-preset",
      "minimax-cn-preset",
      "xiaomi-mimo-cn-preset",
      "openrouter-global-preset",
      "groq-global-preset",
      "together-global-preset",
      "fireworks-global-preset",
      "mistral-global-preset",
      "nebius-global-preset",
      "step-cn-preset",
      "baichuan-cn-preset",
      "zero-one-cn-preset",
    ]);
    // Every preset must carry the fields the setup flow reads.
    for (const protocol of PROTOCOLS) {
      expect(protocol.label).toBeTruthy();
    }
    // DeepSeek and Zhipu Messages speak the Anthropic shape.
    expect(mapProtocolToProvider("deepseek-global-preset")).toBe("anthropic");
    expect(mapProtocolToProvider("zhipu-global-preset")).toBe("anthropic");
    // The domestic Zhipu endpoint speaks the OpenAI shape.
    expect(mapProtocolToProvider("zhipu-cn-preset")).toBe("openai");
    // Moonshot keeps its own adapter.
    expect(mapProtocolToProvider("moonshot-cn-preset")).toBe("moonshot");
  });

  test("keeps vendor presets region-qualified and free of duplicate endpoints", () => {
    const vendors = PROTOCOLS.filter((protocol) =>
      protocol.id.endsWith("-preset"),
    );
    const endpoints = vendors.map((protocol) =>
      protocol.defaultApiBase.replace(/\/+$/, ""),
    );

    expect(new Set(endpoints).size).toBe(endpoints.length);
    expect(new Set(vendors.map((protocol) => protocol.id)).size).toBe(
      vendors.length,
    );
    expect(
      vendors
        .filter((protocol) => protocol.id.includes("minimax"))
        .map((protocol) => protocol.label),
    ).toEqual(["MiniMax (Global)", "MiniMax (CN)"]);
    expect(
      vendors
        .filter((protocol) => protocol.id.includes("zhipu"))
        .map((protocol) => protocol.label),
    ).toEqual(["Zhipu GLM (Global)", "Zhipu GLM (CN)"]);
    expect(
      vendors.every((protocol) => / \((?:CN|Global)\)$/.test(protocol.label)),
    ).toBe(true);
  });

  test("offers Ollama and local models as the fifth protocol", () => {
    const ollama = PROTOCOLS[4];
    expect(ollama.defaultApiBase).toBe("http://localhost:11434/v1/");
    expect(ollama.exampleModel).toBe("llama3.2");
  });

  test("maps an OpenAI-compatible protocol to the openai adapter provider", () => {
    expect(mapProtocolToProvider("openai-compatible")).toBe("openai");
    expect(
      buildConfigYaml({ ...base, protocol: "openai-compatible" }),
    ).toContain("provider: openai");
  });

  test("maps protocol choices to their adapter providers", () => {
    expect(
      buildConfigYaml({ ...base, protocol: "anthropic-messages" }),
    ).toContain("provider: anthropic");
    expect(
      buildConfigYaml({ ...base, protocol: "google-generative-ai" }),
    ).toContain("provider: gemini");
  });

  test("marks OpenAI Responses protocol explicitly", () => {
    expect(
      buildConfigYaml({ ...base, protocol: "openai-responses" }),
    ).toContain("useResponsesApi: true");
  });

  test("uses OpenAI completions for the DeepSeek endpoint and default model", () => {
    const yaml = buildConfigYaml({
      protocol: "openai-compatible",
      apiBase: "https://api.deepseek.com/v1",
      apiKey: fixtureKey("deepseek"),
      model: "",
    });

    expect(yaml).toContain("provider: deepseek");
    expect(yaml).toContain('apiBase: "https://api.deepseek.com/"');
    expect(yaml).toContain('model: "deepseek-chat"');
  });

  test("keeps the vendor's path when listing models", async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({ data: [{ id: "m-1" }] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(
        await fetchModelIds({
          apiBase: "https://openrouter.ai/api/v1",
          apiKey: "probe",
          modelsPath: "/api/v1/models",
        }),
      ).toEqual(["m-1"]);
      expect(requested[0]).toBe("https://openrouter.ai/api/v1/models");

      expect(
        await fetchModelIds({
          apiBase: "http://127.0.0.1:3425/v1",
          apiKey: "probe",
        }),
      ).toEqual(["m-1"]);
      expect(requested[1]).toBe("http://127.0.0.1:3425/v1/models");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("falls back to x-api-key when Bearer is refused", async () => {
    const headerSets: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      headerSets.push((options?.headers ?? {}) as Record<string, string>);
      return new Response(
        headerSets.length === 1
          ? "unauthorized"
          : JSON.stringify({ data: [{ id: "m-2" }] }),
        { status: headerSets.length === 1 ? 401 : 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(
        await fetchModelIds({
          apiBase: "https://api.anthropic.com/v1",
          apiKey: "probe",
        }),
      ).toEqual(["m-2"]);
      expect(headerSets[0]?.Authorization).toBe("Bearer probe");
      expect(headerSets[1]?.["x-api-key"]).toBe("probe");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("writes a minimal config without roles, completion options or dead keys", () => {
    const yaml = buildConfigYaml(base);

    expect(yaml).toContain("name: TNT");
    // The hub package format needed a version; nothing in TNT reads one, so the
    // setup no longer writes either of them into a user's file.
    expect(yaml).not.toContain("version:");
    expect(yaml).not.toContain("schema:");
    expect(yaml).toContain("provider: openai");
    expect(yaml).toContain(`model: \"gpt-4.1\"`);
    expect(yaml).toContain(`apiBase: \"https://api.openai.com/v1\"`);
    expect(yaml).toContain(`apiKey: \"${fixtureKey("test")}\"`);
    expect(yaml).not.toContain("roles:");
    expect(yaml).not.toContain("defaultCompletionOptions:");
  });

  test("omits apiBase when the custom endpoint supplies its own URL", () => {
    const yaml = buildConfigYaml({ ...base, apiBase: "" });
    expect(yaml).not.toContain("apiBase:");
  });

  test("escapes quotes and backslashes in user-provided values", () => {
    const yaml = buildConfigYaml({
      protocol: "openai-compatible",
      apiBase: "",
      apiKey: 'secret\\key"quote',
      model: 'model"name\\with\\slashes',
    });
    expect(yaml).toContain('model: "model\\"name\\\\with\\\\slashes"');
  });

  test("every protocol option has the fields the flow needs", () => {
    for (const protocol of PROTOCOLS) {
      expect(protocol.id).toBeTruthy();
      expect(protocol.label).toBeTruthy();
      expect(protocol.defaultModel).toBeDefined();
      expect(protocol.contextLength).toBeGreaterThan(0);
      expect(protocol.maxTokens).toBeGreaterThan(0);
    }
  });
});

describe("interactive provider setup flow", () => {
  beforeEach(() => {
    questionMock.mockReset();
  });

  test("walks protocol -> url -> key -> model and returns the answers", async () => {
    questionMock
      .mockResolvedValueOnce("5") // protocol: any OpenAI-compatible endpoint
      .mockResolvedValueOnce("http://localhost:8000/v1") // base URL
      .mockResolvedValueOnce(fixtureKey("local")) // API key
      .mockResolvedValueOnce("qwen2.5-coder"); // model

    const setup = await runProviderSetup();

    expect(setup).toEqual({
      protocol: "openai-compatible",
      apiBase: "http://localhost:8000/v1",
      apiKey: fixtureKey("local"),
      model: "qwen2.5-coder",
    });
    expect(questionMock).toHaveBeenCalledTimes(4);
  });

  test("falls back to the protocol default URL and model when left blank", async () => {
    questionMock
      .mockResolvedValueOnce("3") // Anthropic Messages
      .mockResolvedValueOnce("") // accept default URL
      .mockResolvedValueOnce(fixtureKey("anthropic"))
      .mockResolvedValueOnce(""); // accept default model

    const setup = await runProviderSetup();

    expect(setup.protocol).toBe("anthropic-messages");
    expect(setup.apiBase).toBe("https://api.anthropic.com/v1");
    expect(setup.model).toBe("claude-sonnet-4-5");
  });

  test("re-asks until a non-empty API key is given", async () => {
    questionMock
      .mockResolvedValueOnce("1") // OpenAI Chat Completions
      .mockResolvedValueOnce("") // default URL
      .mockResolvedValueOnce("   ") // blank key, should re-ask
      .mockResolvedValueOnce(fixtureKey("real"))
      .mockResolvedValueOnce("gpt-4.1");

    const setup = await runProviderSetup();

    expect(setup.apiKey).toBe(fixtureKey("real"));
    expect(questionMock).toHaveBeenCalledTimes(5);
  });

  test("rejects an out-of-range protocol number", async () => {
    questionMock.mockResolvedValueOnce("99");
    await expect(runProviderSetup()).rejects.toThrow();
  });
});
