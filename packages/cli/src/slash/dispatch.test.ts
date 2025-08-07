import type { AssistantUnrolled } from "@tnt/config-yaml";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

import type { ConfigServiceState } from "../services/types.js";
import { getLocale, setLocale } from "../i18n/index.js";
import { handleSlashCommands } from "./dispatch.js";

// Mock the services
vi.mock("../services/index.js", () => ({
  services: {
    config: {
      getState: vi.fn(),
    },
    model: {
      getModelInfo: vi.fn(),
    },
  },
  reloadService: vi.fn(),
  SERVICE_NAMES: {
    AUTH: "AUTH",
  },
}));

// Mock commands
vi.mock("./service.js", () => ({
  getAllSlashCommands: vi.fn(() => []),
}));

// Mock logger to avoid file system operations
vi.mock("../util/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock env.js to avoid file operations
vi.mock("../config/env.js", () => ({
  env: {
    continueHome: "/home/test/.continue",
  },
}));

// Mock os and path
vi.mock("os", () => ({
  default: {
    homedir: vi.fn(() => "/home/test"),
  },
  homedir: vi.fn(() => "/home/test"),
}));

vi.mock("path", () => ({
  default: {
    join: vi.fn((...parts) => parts.join("/")),
    isAbsolute: vi.fn((p: string) => p.startsWith("/")),
    resolve: vi.fn((...parts) => parts.join("/")),
  },
  join: vi.fn((...parts) => parts.join("/")),
  isAbsolute: vi.fn((p: string) => p.startsWith("/")),
  resolve: vi.fn((...parts) => parts.join("/")),
}));

// Mock history manager to avoid file system operations
vi.mock("core/util/history.js", () => ({
  default: {
    list: vi.fn(() => []),
    load: vi.fn(() => ({ history: [] })),
    save: vi.fn(),
  },
}));

// Mock session functions
vi.mock("../session/index.js", () => ({
  getSessionFilePath: vi.fn(
    () => "/home/test/.tnt/cli-sessions/continue-cli-pid-12345.json",
  ),
  hasSession: vi.fn(() => false),
  getCurrentSession: vi.fn(() => {
    throw new Error("Session not available");
  }),
  listSubagentSessions: vi.fn(() => []),
  updateSessionTitle: vi.fn(),
}));

// Mock the plugin registry so plugin commands can be exercised without disk
vi.mock("../plugins/loader.js", () => ({
  loadAllPlugins: vi.fn(() => ({
    plugins: [],
    hooks: { hooks: {} },
    commands: [
      { name: "sample:review", description: "Review", content: "Review body" },
    ],
    agents: [],
    skills: [],
    mcpServers: {},
    outputStyles: [],
    lspServers: [],
  })),
}));

describe("slashCommands", () => {
  const mockAssistant: AssistantUnrolled = {
    name: "test-assistant",
    version: "1.0.0",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleSlashCommands", () => {
    it("should handle /help command", async () => {
      const result = await handleSlashCommands("/help", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain("Keyboard Shortcuts:");
      expect(result?.output).toContain("Navigation:");
      expect(result?.output).toContain("\u2191/\u2193");
      expect(result?.output).toContain("Tab");
      expect(result?.output).toContain("Enter");
      expect(result?.output).toContain("Shift+Enter");
      expect(result?.output).toContain("Controls:");
      expect(result?.output).toContain("Ctrl+C");
      expect(result?.output).toContain("Ctrl+D");
      expect(result?.output).toContain("Ctrl+L");
      expect(result?.output).toContain("Shift+Tab");
      expect(result?.output).toContain("Esc");
      expect(result?.output).toContain("Special Characters:");
      expect(result?.output).toContain("@");
      expect(result?.output).toContain("/");
      expect(result?.exit).toBeUndefined();
    });

    it("switches and persists the display language", async () => {
      const originalLocale = getLocale();
      try {
        const result = await handleSlashCommands(
          "/language zh-CN",
          mockAssistant,
        );

        expect(getLocale()).toBe("zh-CN");
        expect(result?.output).toContain("语言已切换为 zh-CN");
      } finally {
        setLocale(originalLocale);
      }
    });

    it("should handle /info command and show config info", async () => {
      const { services } = await import("../services/index.js");

      (
        services.config.getState as MockedFunction<
          typeof services.config.getState
        >
      ).mockReturnValue({
        config: null,
        configPath: "/test/config.yaml",
      } as ConfigServiceState);

      const result = await handleSlashCommands("/info", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain("Configuration:");
      expect(result?.output).toContain("/test/config.yaml");
      expect(result?.output).toContain("Session:");
      expect(result?.output).toContain("Session not available");
      expect(result?.exit).toBe(false);
    });

    it("should handle /info command when config not found", async () => {
      const { services } = await import("../services/index.js");

      (
        services.config.getState as MockedFunction<
          typeof services.config.getState
        >
      ).mockReturnValue({
        config: null,
        configPath: undefined,
      } as ConfigServiceState);

      const result = await handleSlashCommands("/info", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain("Configuration:");
      expect(result?.output).toContain("Config not found");
      expect(result?.exit).toBe(false);
    });

    it("should handle /info command with config path", async () => {
      const { services } = await import("../services/index.js");

      (
        services.config.getState as MockedFunction<
          typeof services.config.getState
        >
      ).mockReturnValue({
        config: null,
        configPath: "/custom/config.yaml",
      } as ConfigServiceState);

      const result = await handleSlashCommands("/info", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain("Configuration:");
      expect(result?.output).toContain("/custom/config.yaml");
      expect(result?.exit).toBe(false);
    });

    it("should handle config service errors gracefully", async () => {
      const { services } = await import("../services/index.js");

      (
        services.config.getState as MockedFunction<
          typeof services.config.getState
        >
      ).mockImplementation(() => {
        throw new Error("Service not ready");
      });

      const result = await handleSlashCommands("/info", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain("Configuration service not available");
    });

    it("should use test session directory when in test mode", async () => {
      const { services } = await import("../services/index.js");
      const { getSessionFilePath, getCurrentSession } = await import(
        "../session/index.js"
      );

      // Mock the session functions for this specific test
      (getSessionFilePath as any).mockReturnValue(
        "/test-home/.tnt/cli-sessions/continue-cli-test-123.json",
      );
      (getCurrentSession as any).mockReturnValue({
        sessionId: "test-123",
        title: "Test Session",
      });

      (
        services.config.getState as MockedFunction<
          typeof services.config.getState
        >
      ).mockReturnValue({
        config: null,
        configPath: undefined,
      } as ConfigServiceState);

      const result = await handleSlashCommands("/info", mockAssistant);

      expect(result?.output).toContain("Session:");
      expect(result?.output).toContain("Test Session");
      expect(result?.output).toContain("/test-home/.tnt/cli-sessions/");
      expect(result?.output).toContain(".json");
    });

    it("should handle /title command with valid title", async () => {
      const { updateSessionTitle } = await import("../session/index.js");

      const result = await handleSlashCommands(
        "/title My New Session Title",
        mockAssistant,
      );

      expect(updateSessionTitle).toHaveBeenCalledWith("My New Session Title");
      expect(result).toBeDefined();
      expect(result?.output).toContain(
        'Session title updated to: "My New Session Title"',
      );
      expect(result?.exit).toBe(false);
    });

    it("should handle /title command with empty title", async () => {
      const result = await handleSlashCommands("/title", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain(
        "Please provide a title. Usage: /title <your title>",
      );
      expect(result?.exit).toBe(false);
    });

    it("should handle /title command with whitespace-only title", async () => {
      const result = await handleSlashCommands("/title   ", mockAssistant);

      expect(result).toBeDefined();
      expect(result?.output).toContain(
        "Please provide a title. Usage: /title <your title>",
      );
      expect(result?.exit).toBe(false);
    });

    it("should handle /title command when session update fails", async () => {
      const { updateSessionTitle } = await import("../session/index.js");

      (updateSessionTitle as any).mockImplementation(() => {
        throw new Error("Failed to save session");
      });

      const result = await handleSlashCommands(
        "/title Test Title",
        mockAssistant,
      );

      expect(result).toBeDefined();
      expect(result?.output).toContain(
        "Failed to update title: Failed to save session",
      );
      expect(result?.exit).toBe(false);
    });

    it("should handle /rename as an alias for /title", async () => {
      const { updateSessionTitle } = await import("../session/index.js");
      (updateSessionTitle as any).mockReset();

      const result = await handleSlashCommands(
        "/rename My Renamed Session",
        mockAssistant,
      );

      expect(updateSessionTitle).toHaveBeenCalledWith("My Renamed Session");
      expect(result).toBeDefined();
      expect(result?.output).toContain(
        'Session title updated to: "My Renamed Session"',
      );
      expect(result?.exit).toBe(false);
    });

    it("should handle custom assistant prompts", async () => {
      const assistantWithPrompts: AssistantUnrolled = {
        ...mockAssistant,
        prompts: [
          {
            name: "explain",
            description: "Explain the code",
            prompt: "Please explain the following code:",
          },
        ],
      };

      const result = await handleSlashCommands(
        "/explain some code",
        assistantWithPrompts,
      );

      expect(result).toBeDefined();
      expect(result?.newInput).toBe(
        "Please explain the following code:some code",
      );
    });

    it("should handle invokable rules", async () => {
      const assistantWithRules: AssistantUnrolled = {
        ...mockAssistant,
        rules: [
          {
            name: "review",
            description: "Review this code",
            rule: "Perform a code review on the following:",
            invokable: true,
          },
        ],
      };

      const result = await handleSlashCommands(
        "/review some code",
        assistantWithRules,
      );

      expect(result).toBeDefined();
      expect(result?.newInput).toBe(
        "Perform a code review on the following: some code",
      );
    });

    it("should not treat non-invokable rules as slash commands", async () => {
      const assistantWithNonInvokableRule: AssistantUnrolled = {
        ...mockAssistant,
        rules: [
          {
            name: "regular",
            description: "A regular rule",
            rule: "This is a regular rule",
            invokable: false,
          },
        ],
      };

      const result = await handleSlashCommands(
        "/regular",
        assistantWithNonInvokableRule,
      );

      // Should return null because the rule is not invokable
      expect(result).toBeNull();
    });

    it("should handle invokable rules from hub (string rules ignored)", async () => {
      const assistantWithMixedRules: AssistantUnrolled = {
        ...mockAssistant,
        rules: [
          "string rule",
          {
            name: "analyze",
            description: "Analyze code patterns",
            rule: "Analyze the following code for patterns:",
            invokable: true,
          },
        ],
      };

      const result = await handleSlashCommands(
        "/analyze my code",
        assistantWithMixedRules,
      );

      expect(result).toBeDefined();
      expect(result?.newInput).toBe(
        "Analyze the following code for patterns: my code",
      );
    });
  });

  describe("/subagents", () => {
    const originalLocale = getLocale();

    afterEach(() => {
      setLocale(originalLocale);
    });

    async function mockSubagents(
      parentId: string,
      children: {
        sessionId: string;
        subagentType?: string;
        firstUserMessage?: string;
      }[],
    ) {
      const { getCurrentSession, listSubagentSessions } = await import(
        "../session/index.js"
      );
      (getCurrentSession as any).mockReturnValue({ sessionId: parentId });
      (listSubagentSessions as any).mockReturnValue(children);
    }

    it("says so when nothing has been delegated yet", async () => {
      await mockSubagents("parent", []);

      const result = await handleSlashCommands("/subagents", mockAssistant);

      expect(result?.exit).toBe(false);
      expect(result?.output).toContain(
        "No subagent sessions for this conversation yet.",
      );
    });

    it("lists the delegated sessions of the current session", async () => {
      await mockSubagents("parent", [
        {
          sessionId: "parent:one",
          subagentType: "Explore",
          firstUserMessage: "Find the parser\nmore",
        },
        { sessionId: "parent:two" },
      ]);

      const result = await handleSlashCommands("/subagents", mockAssistant);

      expect(result?.output).toContain("Subagent sessions (2)");
      expect(result?.output).toContain("Explore parent:one - Find the parser");
      expect(result?.output).not.toContain("more");
      expect(result?.output).toContain("agent parent:two");
    });

    it("queries children of the current session only", async () => {
      await mockSubagents("parent", []);

      await handleSlashCommands("/subagents", mockAssistant);

      const { listSubagentSessions } = await import("../session/index.js");
      expect(listSubagentSessions).toHaveBeenCalledWith("parent");
    });

    it("follows the active locale", async () => {
      setLocale("zh-CN");
      await mockSubagents("parent", [{ sessionId: "parent:one" }]);

      const result = await handleSlashCommands("/subagents", mockAssistant);

      expect(result?.output).toContain("子代理会话（1）");
      expect(result?.output).toContain("子代理 parent:one");
    });

    it("offers the picker once children exist", async () => {
      await mockSubagents("parent", [{ sessionId: "parent:one" }]);

      const result = await handleSlashCommands("/subagents", mockAssistant);

      expect(result?.openSubagentsSelector).toBe(true);
    });
  });

  describe("/back", () => {
    async function mockCurrentSession(session: Record<string, unknown>) {
      const { getCurrentSession } = await import("../session/index.js");
      (getCurrentSession as any).mockReturnValue(session);
    }

    it("returns to the parent of a delegated session", async () => {
      await mockCurrentSession({
        sessionId: "parent:one",
        parentSessionId: "parent",
      });

      const result = await handleSlashCommands("/back", mockAssistant);

      expect(result?.loadSessionId).toBe("parent");
    });

    it("says so when the session has no parent", async () => {
      await mockCurrentSession({ sessionId: "parent" });

      const result = await handleSlashCommands("/back", mockAssistant);

      expect(result?.loadSessionId).toBeUndefined();
      expect(result?.output).toContain("not a delegated session");
    });

    it("is also reachable as /parent", async () => {
      await mockCurrentSession({
        sessionId: "parent:one",
        parentSessionId: "parent",
      });

      const result = await handleSlashCommands("/parent", mockAssistant);

      expect(result?.loadSessionId).toBe("parent");
    });
  });

  describe("plugin commands", () => {
    it("forwards the command body with the given arguments", async () => {
      const result = await handleSlashCommands(
        "/sample:review src/app.ts",
        mockAssistant,
      );

      expect(result?.newInput).toBe("Review body\n\nsrc/app.ts");
    });

    it("forwards the command body on its own when no arguments are given", async () => {
      const result = await handleSlashCommands("/sample:review", mockAssistant);

      expect(result?.newInput).toBe("Review body");
    });
  });
});
