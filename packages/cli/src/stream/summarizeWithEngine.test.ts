import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockModelState = vi.hoisted(() => ({
  assistant: null as { models: unknown[] } | null,
}));

vi.mock("./streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(async () => "summary text"),
}));

vi.mock("../services/index.js", () => ({
  services: {
    model: {
      getState: () => ({ assistant: mockModelState.assistant }),
    },
  },
}));

vi.mock("../config/index.js", () => ({
  createLlmApi: vi.fn(() => "built-summarizer-api"),
}));

import { createLlmApi } from "../config/index.js";
import { ModelService } from "../services/ModelService.js";

import { streamChatResponse } from "./streamChatResponse.js";
import { summarizeWithEngine } from "./summarizeWithEngine.js";

const mainModel = {
  name: "main-model",
  model: "main-model-id",
  provider: "openai",
} as unknown as ModelConfig;

const mainLlmApi = { id: "main-api" } as unknown as BaseLlmApi;
const abortController = new AbortController();
const history: ChatHistoryItem[] = [
  { message: { role: "user", content: "Hello" }, contextItems: [] },
];

const callbacks = {
  onContent: vi.fn(),
  onContentComplete: vi.fn(),
};

describe("summarizeWithEngine model routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.assistant = null;
  });

  it("runs the summary on a configured summarize-role model", async () => {
    const cheapApi = { id: "cheap-api" } as unknown as BaseLlmApi;
    vi.spyOn(ModelService, "findModelByRole").mockImplementationOnce(() => ({
      llmApi: cheapApi,
      model: {
        name: "cheap-model",
        model: "cheap-model-id",
        provider: "openai",
        roles: ["summarize"],
      } as unknown as ModelConfig,
      assistant: null,
    }));

    await summarizeWithEngine({
      history,
      model: mainModel,
      llmApi: mainLlmApi,
      abortController,
      callbacks,
    });

    expect(streamChatResponse).toHaveBeenCalledWith(
      history,
      expect.objectContaining({ name: "cheap-model" }),
      cheapApi,
      abortController,
      expect.objectContaining({
        onContent: callbacks.onContent,
        onContentComplete: callbacks.onContentComplete,
      }),
      true,
    );
  });

  it("falls back to the caller's model when nothing is marked", async () => {
    vi.spyOn(ModelService, "findModelByRole").mockImplementationOnce(
      () => null,
    );

    await summarizeWithEngine({
      history,
      model: mainModel,
      llmApi: mainLlmApi,
      abortController,
      callbacks,
    });

    expect(streamChatResponse).toHaveBeenCalledWith(
      history,
      mainModel,
      mainLlmApi,
      abortController,
      expect.anything(),
      true,
    );
  });

  it("keeps the caller's engine when the marked entry is the caller's model", async () => {
    vi.spyOn(ModelService, "findModelByRole").mockImplementationOnce(() => ({
      llmApi: { id: "duplicate-api" } as unknown as BaseLlmApi,
      model: mainModel,
      assistant: null,
    }));

    await summarizeWithEngine({
      history,
      model: mainModel,
      llmApi: mainLlmApi,
      abortController,
      callbacks,
    });

    expect(streamChatResponse).toHaveBeenCalledWith(
      history,
      mainModel,
      mainLlmApi,
      abortController,
      expect.anything(),
      true,
    );
  });

  it("reads the marked entry from the loaded config through the model service", async () => {
    mockModelState.assistant = {
      models: [
        {
          name: "cheap-model",
          model: "cheap-model-id",
          provider: "openai",
          roles: ["summarize"],
        },
      ],
    };
    vi.mocked(createLlmApi).mockReturnValue({
      id: "from-config",
    } as unknown as BaseLlmApi);

    await summarizeWithEngine({
      history,
      model: mainModel,
      llmApi: mainLlmApi,
      abortController,
      callbacks,
    });

    expect(createLlmApi).toHaveBeenCalledWith(
      expect.objectContaining({ name: "cheap-model" }),
    );
    expect(streamChatResponse).toHaveBeenCalledWith(
      history,
      expect.objectContaining({ name: "cheap-model" }),
      expect.objectContaining({ id: "from-config" }),
      abortController,
      expect.anything(),
      true,
    );
  });
});
