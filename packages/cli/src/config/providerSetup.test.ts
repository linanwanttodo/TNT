import { beforeEach, describe, expect, test, vi } from "vitest";

const questionMock = vi.fn();

vi.mock("../utils/prompt.js", () => ({
  question: (...args: unknown[]) => questionMock(...args),
}));

import {
  PROTOCOLS,
  buildConfigYaml,
  mapProtocolToProvider,
  type ProviderSetup,
  runProviderSetup,
} from "./providerSetup.js";

describe("provider setup config generation", () => {
  const base: ProviderSetup = {
    protocol: "openai-chat-completions",
    apiBase: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    model: "gpt-4.1",
  };

  test("offers five protocol choices rather than a vendor list", () => {
    expect(PROTOCOLS.map((protocol) => protocol.id)).toEqual([
      "openai-chat-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
      "openai-compatible",
    ]);
    expect(PROTOCOLS.map((protocol) => protocol.label)).toEqual([
      "OpenAI Chat Completions",
      "OpenAI Responses",
      "Anthropic Messages",
      "Google Generative AI",
      "OpenAI-compatible endpoint",
    ]);
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
      apiKey: "sk-deepseek",
      model: "",
    });

    expect(yaml).toContain("provider: deepseek");
    expect(yaml).toContain('apiBase: "https://api.deepseek.com/"');
    expect(yaml).toContain('model: "deepseek-chat"');
  });

  test("writes a minimal schema v1 config without roles or completion options", () => {
    const yaml = buildConfigYaml(base);

    expect(yaml).toContain("name: TNT");
    expect(yaml).toContain("version: 1.0.0");
    expect(yaml).toContain("schema: v1");
    expect(yaml).toContain("provider: openai");
    expect(yaml).toContain(`model: \"gpt-4.1\"`);
    expect(yaml).toContain(`apiBase: \"https://api.openai.com/v1\"`);
    expect(yaml).toContain(`apiKey: \"sk-test-key\"`);
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
      apiKey: 'sk-secret\\key"quote',
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
      .mockResolvedValueOnce("sk-local") // API key
      .mockResolvedValueOnce("qwen2.5-coder"); // model

    const setup = await runProviderSetup();

    expect(setup).toEqual({
      protocol: "openai-compatible",
      apiBase: "http://localhost:8000/v1",
      apiKey: "sk-local",
      model: "qwen2.5-coder",
    });
    expect(questionMock).toHaveBeenCalledTimes(4);
  });

  test("falls back to the protocol default URL and model when left blank", async () => {
    questionMock
      .mockResolvedValueOnce("3") // Anthropic Messages
      .mockResolvedValueOnce("") // accept default URL
      .mockResolvedValueOnce("sk-ant-key")
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
      .mockResolvedValueOnce("sk-real")
      .mockResolvedValueOnce("gpt-4.1");

    const setup = await runProviderSetup();

    expect(setup.apiKey).toBe("sk-real");
    expect(questionMock).toHaveBeenCalledTimes(5);
  });

  test("rejects an out-of-range protocol number", async () => {
    questionMock.mockResolvedValueOnce("99");
    await expect(runProviderSetup()).rejects.toThrow();
  });
});
