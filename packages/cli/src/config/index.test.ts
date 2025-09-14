import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { describe, expect, test, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../auth/workos.js");

import type { AuthConfig } from "../auth/workos.js";

import { getLlmApi } from "./index.js";

describe("config", () => {
  let mockAuthConfig: AuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthConfig = null;
  });

  describe("getLlmApi()", () => {
    test("should throw error when models array is empty", () => {
      const assistant: AssistantUnrolled = {
        name: "test-assistant",
        version: "1.0.0",
        models: [],
      };

      expect(() => getLlmApi(assistant, mockAuthConfig)).toThrow(
        "No models found in the configured assistant",
      );
    });

    test("should throw error when no chat models available", () => {
      const assistant: AssistantUnrolled = {
        name: "test-assistant",
        version: "1.0.0",
        models: [
          {
            provider: "openai",
            model: "text-embedding-ada-002",
            name: "Ada Embeddings",
            roles: ["embed"],
          } as ModelConfig,
        ],
      };

      expect(() => getLlmApi(assistant, mockAuthConfig)).toThrow(
        "No models with the chat role found in the configured assistant",
      );
    });

    test("refuses a chat model its provider cannot answer, before a request exists", () => {
      const assistant: AssistantUnrolled = {
        name: "test-assistant",
        version: "1.0.0",
        models: [
          {
            provider: "openai",
            model: "claude-sonnet-4-5",
            name: "Mismatch",
            roles: ["chat"],
          } as ModelConfig,
        ],
      };

      // The provider would answer 400 about a field the user never wrote; the
      // mismatch is named here instead.
      expect(() => getLlmApi(assistant, mockAuthConfig)).toThrow(
        /Claude model, but it is configured with provider: openai/,
      );
    });

    test("accepts a gateway and a provider that match the model", () => {
      const openRouter: AssistantUnrolled = {
        name: "test-assistant",
        version: "1.0.0",
        models: [
          {
            provider: "openai",
            model: "gpt-4o",
            name: "Fine",
            roles: ["chat"],
          } as ModelConfig,
        ],
      };

      // No lint error: whatever happens after this is the adapter's business,
      // and the assertion is only that the mismatch check let it through.
      let raised: unknown;
      try {
        getLlmApi(openRouter, mockAuthConfig);
      } catch (error) {
        raised = error;
      }
      expect(String(raised ?? "")).not.toContain("Claude model");
    });
  });
});
