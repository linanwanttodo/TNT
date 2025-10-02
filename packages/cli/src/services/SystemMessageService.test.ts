import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SystemMessageService } from "./SystemMessageService.js";

import { services } from "./index.js";
const toolPermissionService = services.toolPermissions;

// Mock the systemMessage module. Only the builder is stubbed - the join and the
// change report are what the service wires together, so they stay real.
vi.mock("../agent/systemMessage.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/systemMessage.js")>();
  return {
    ...actual,
    buildSystemMessageSections: vi.fn(),
  };
});

// Mock the logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SystemMessageService", () => {
  let service: SystemMessageService;
  let buildSectionsMock: any;

  /** A stub build: one section carrying the text the assertions expect back. */
  const builtFrom = (text: string) => [{ name: "test", text, volatile: false }];

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Get mock reference
    const { buildSystemMessageSections } = await import(
      "../agent/systemMessage.js"
    );
    buildSectionsMock = buildSystemMessageSections as any;

    // Create new service instance
    service = new SystemMessageService();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe("initialization", () => {
    it("should initialize with provided configuration", async () => {
      const config = {
        additionalRules: ["rule1", "rule2"],
        format: "json" as const,
        headless: true,
      };

      const state = await service.initialize(config);

      expect(state).toEqual(config);
      expect(service.isReady()).toBe(true);
    });

    it("should initialize with empty configuration", async () => {
      const state = await service.initialize({});

      expect(state).toEqual({});
      expect(service.isReady()).toBe(true);
    });
  });

  describe("change attribution", () => {
    it("reports the section the last rebuild moved", async () => {
      buildSectionsMock.mockResolvedValueOnce([
        { name: "base", text: "A", volatile: false },
      ]);
      await service.getSystemMessage("agent");
      expect(service.describeLastSystemMessageChange()).toBe("");

      buildSectionsMock.mockResolvedValueOnce([
        { name: "base", text: "A", volatile: false },
        { name: "planMode", text: "P", volatile: true },
      ]);
      await service.getSystemMessage("plan");
      expect(service.describeLastSystemMessageChange()).toBe("planMode added");

      buildSectionsMock.mockResolvedValueOnce([
        { name: "base", text: "A", volatile: false },
        { name: "planMode", text: "P2", volatile: true },
      ]);
      await service.getSystemMessage("plan");
      expect(service.describeLastSystemMessageChange()).toBe(
        "planMode rewritten",
      );
    });
  });

  describe("getSystemMessage", () => {
    it("builds with the current configuration and mode", async () => {
      const config = {
        additionalRules: ["rule1"],
        format: "json" as const,
        headless: true,
      };

      buildSectionsMock.mockResolvedValue(builtFrom("Test system message"));

      await service.initialize(config);
      const message = await service.getSystemMessage("agent");

      expect(buildSectionsMock).toHaveBeenCalledWith(
        "agent", // Default mode
        ["rule1"],
        "json",
        true,
        undefined,
      );
      expect(message).toBe("Test system message");
    });
  });

  describe("updateConfig", () => {
    it("should update configuration partially", async () => {
      await service.initialize({
        additionalRules: ["rule1"],
        headless: false,
      });

      service.updateConfig({
        format: "json",
      });

      buildSectionsMock.mockResolvedValue(builtFrom("Updated message"));
      await service.getSystemMessage("agent");

      expect(buildSectionsMock).toHaveBeenCalledWith(
        "agent",
        ["rule1"],
        "json",
        false,
        undefined,
      );
    });

    it("should override existing configuration", async () => {
      await service.initialize({
        additionalRules: ["rule1"],
        format: "json" as const,
      });

      service.updateConfig({
        additionalRules: ["rule2", "rule3"],
      });

      buildSectionsMock.mockResolvedValue(builtFrom("Updated message"));
      await service.getSystemMessage("agent");

      expect(buildSectionsMock).toHaveBeenCalledWith(
        "agent",
        ["rule2", "rule3"],
        "json",
        undefined,
        undefined,
      );
    });
  });

  describe("error handling", () => {
    it("lets a build failure reach the caller", async () => {
      buildSectionsMock.mockRejectedValue(new Error("Failed to construct"));

      await service.initialize({});

      await expect(service.getSystemMessage("agent")).rejects.toThrow(
        "Failed to construct",
      );
    });
  });
});
