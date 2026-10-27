import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getPersistedModelName, persistModelName } from "./modelPersistence.js";

describe("Model Persistence Integration", () => {
  let testDir: string;
  let originalContinueHome: string | undefined;

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-test-"));
    originalContinueHome = process.env.CONTINUE_GLOBAL_DIR;
    process.env.CONTINUE_GLOBAL_DIR = testDir;

    // Clear GlobalContext for clean test state
    persistModelName(null);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    if (originalContinueHome) {
      process.env.CONTINUE_GLOBAL_DIR = originalContinueHome;
    } else {
      delete process.env.CONTINUE_GLOBAL_DIR;
    }
  });

  test("should persist model name when user selects a model", () => {
    // User selects a model (auth is always null now)
    persistModelName("Claude 3.5 Sonnet");

    // Verify model name is persisted via GlobalContext
    expect(getPersistedModelName()).toBe("Claude 3.5 Sonnet");
  });

  test("should update model name when user switches models", () => {
    // Set initial model
    persistModelName("GPT-4");
    expect(getPersistedModelName()).toBe("GPT-4");

    // User switches to a different model
    persistModelName("Claude 3.5 Sonnet");

    // Verify new model name
    expect(getPersistedModelName()).toBe("Claude 3.5 Sonnet");
  });

  test("should clear model name when set to null", () => {
    // Set a model
    persistModelName("GPT-4");
    expect(getPersistedModelName()).toBe("GPT-4");

    // Clear model name
    persistModelName(null);

    // Verify model name is cleared
    expect(getPersistedModelName()).toBeNull();
  });

  test("should return null for model name when no model persisted", () => {
    // No model persisted and no auth config
    persistModelName(null); // Ensure GlobalContext is clear
    expect(getPersistedModelName()).toBeNull();
  });

  test("should persist model name via GlobalContext", () => {
    persistModelName("Claude 3.5 Sonnet");

    // Verify via getPersistedModelName
    expect(getPersistedModelName()).toBe("Claude 3.5 Sonnet");

    // Verify via getModelName (which reads from GlobalContext)
    expect(getPersistedModelName()).toBe("Claude 3.5 Sonnet");
  });
});
