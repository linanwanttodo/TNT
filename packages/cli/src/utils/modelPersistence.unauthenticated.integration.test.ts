import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fixtureKey } from "../../test-utils/fixtureCredentials.js";
import * as config from "../config/index.js";
import { ModelService } from "../services/ModelService.js";

import { getPersistedModelName, persistModelName } from "./modelPersistence.js";

// Mock the config module
vi.mock("../config/index.js");

describe("Model Persistence (Hub auth removed)", () => {
  let testDir: string;
  let originalTntHome: string | undefined;
  let mockAssistant: AssistantUnrolled;
  const mockLlmApi = { complete: vi.fn(), stream: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a temporary directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-test-"));
    originalTntHome = process.env.CONTINUE_GLOBAL_DIR;
    process.env.CONTINUE_GLOBAL_DIR = testDir;

    // Clear GlobalContext for clean test state
    persistModelName(null);

    mockAssistant = {
      name: "test-assistant",
      version: "1.0.0",
      models: [
        {
          provider: "openai",
          model: "gpt-4",
          name: "GPT-4",
          apiKey: fixtureKey("default"),
          roles: ["chat"],
        } as ModelConfig,
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          name: "Claude 3.5 Sonnet",
          apiKey: fixtureKey("default"),
          roles: ["chat"],
        } as ModelConfig,
        {
          provider: "anthropic",
          model: "claude-3-opus-20240229",
          name: "Claude 3 Opus",
          apiKey: fixtureKey("default"),
          roles: ["chat"],
        } as ModelConfig,
      ],
    } as AssistantUnrolled;

    // Setup default mock behavior
    vi.mocked(config.getLlmApi).mockReturnValue([
      mockLlmApi as any,
      mockAssistant.models![0] as ModelConfig,
    ]);
    vi.mocked(config.createLlmApi).mockReturnValue(mockLlmApi as any);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    if (originalTntHome) {
      process.env.CONTINUE_GLOBAL_DIR = originalTntHome;
    } else {
      delete process.env.CONTINUE_GLOBAL_DIR;
    }
  });

  test("should persist model selection via GlobalContext", () => {
    // Auth is always null now
    persistModelName("Claude 3.5 Sonnet");

    // Verify it was saved to GlobalContext
    const persistedModel = getPersistedModelName();
    expect(persistedModel).toBe("Claude 3.5 Sonnet");

    // Verify getModelName returns it for null config
    expect(getPersistedModelName()).toBe("Claude 3.5 Sonnet");
  });

  test("should restore model selection on next session", async () => {
    // Session 1: User switches model
    const modelService = new ModelService();
    await modelService.initialize(mockAssistant, null);

    await modelService.switchModel(1);
    persistModelName("Claude 3.5 Sonnet");

    // Session 2: User reopens CLI
    const newModelService = new ModelService();
    const state = await newModelService.initialize(mockAssistant, null);

    // Should restore Claude 3.5 Sonnet
    expect(state.model?.name).toBe("Claude 3.5 Sonnet");
  });

  test("should handle multiple model switches and persist last one", () => {
    // Perform multiple switches - only verify the final state
    // to avoid race conditions with concurrent test files using the same GlobalContext
    persistModelName("GPT-4");
    persistModelName("Claude 3.5 Sonnet");
    persistModelName("Claude 3 Opus");
    expect(getPersistedModelName()).toBe("Claude 3 Opus");
  });

  test("should clear model selection when set to null", () => {
    persistModelName("Claude 3.5 Sonnet");
    expect(getPersistedModelName()).toBe("Claude 3.5 Sonnet");

    persistModelName(null);
    expect(getPersistedModelName()).toBeNull();
  });

  test("should work across config changes", async () => {
    // User switches model with one config
    persistModelName("Claude 3.5 Sonnet");

    const modelService = new ModelService();
    let state = await modelService.initialize(mockAssistant, null);
    expect(state.model?.name).toBe("Claude 3.5 Sonnet");

    // User switches to a different model
    await modelService.switchModel(2);
    persistModelName("Claude 3 Opus");

    // Create new service (simulating restart)
    const newModelService = new ModelService();
    state = await newModelService.initialize(mockAssistant, null);
    expect(state.model?.name).toBe("Claude 3 Opus");
  });
});
