import { vi } from "vitest";

import { resetConsoleOverrides } from "./src/startup/init.js";

// Disable telemetry for tests
process.env.CONTINUE_CLI_ENABLE_TELEMETRY = "0";
process.env.CONTINUE_ALLOW_ANONYMOUS_TELEMETRY = "0";

// Pin the locale so suites that assert English strings do not follow the
// machine's LANG. Tests that need another locale call setLocale explicitly.
process.env.LC_ALL = "C.UTF-8";
process.env.LC_MESSAGES = "C.UTF-8";
process.env.LANG = "C.UTF-8";
process.env.LANGUAGE = "";

// Mock fetch to prevent actual API calls in tests
const originalFetch = global.fetch;
global.fetch = vi
  .fn()
  .mockImplementation(async (url: string | URL, ...args) => {
    const urlString = url.toString();

    // Mock the default config API call
    if (
      urlString.includes("get-assistant/tnt/default-cli-config") ||
      urlString.includes("get-assistant/continuedev/default-cli-config")
    ) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          configResult: {
            config: {
              name: "Default Config",
              version: "0.0.1",
              schema: "v1",
              models: [
                {
                  provider: "anthropic",
                  name: "claude-sonnet-4-5",
                  apiKey: "test-key",
                  roles: ["chat"],
                },
              ],
              rules: [],
              mcpServers: [],
            },
            errors: [],
          },
        }),
      };
    }
    return originalFetch(url, ...args);
  });

// Mock the 'open' package to prevent browser opening during tests
vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock constructSystemMessage to avoid service container issues in tests
// Only the two disk-touching exports are stubbed. The section helpers stay real,
// because the system message service now builds through them, and a mock that
// leaves an export out makes every suite that reaches the service fail on a
// missing function instead of on a wrong expectation.
vi.mock("./src/agent/systemMessage.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./src/agent/systemMessage.js")>();
  const stubText =
    "You are an agent in the TNT CLI. Given the user's prompt, you should use the tools available to you to answer the user's question.";
  return {
    ...actual,
    constructSystemMessage: vi.fn().mockResolvedValue(stubText),
    // The service builds through the sections and joins them, so the stub has to
    // answer at that level too or a suite that never registered the config
    // service reaches the real builder and fails on the container instead of on
    // an assertion.
    buildSystemMessageSections: vi
      .fn()
      .mockResolvedValue([{ name: "stub", text: stubText, volatile: false }]),
    loadMarkdownRulesWithMetadata: vi.fn().mockReturnValue([]),
  };
});

// NOTE: CONTINUE_GLOBAL_DIR is set to a unique per-worker temp dir in
// ./vitest.global-dir-setup.ts (which runs first) to isolate the shared
// GlobalContext store across parallel test files. Do not override it here.

// Set up global afterEach hook to clear all timers and reset console
afterEach(() => {
  // Clear vitest timers
  vi.clearAllTimers();

  // Reset console overrides to ensure clean state for each test
  try {
    resetConsoleOverrides();
  } catch {
    // Ignore errors when resetting console
  }
});
