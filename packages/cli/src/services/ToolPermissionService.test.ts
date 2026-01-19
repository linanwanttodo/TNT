import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock modules
vi.mock("../permissions/permissionsYamlLoader.js");
vi.mock("../permissions/precedenceResolver.js");

import * as precedenceResolver from "../permissions/precedenceResolver.js";
import { ToolPermissionPolicy } from "../permissions/types.js";

import { ToolPermissionService } from "./ToolPermissionService.js";

describe("ToolPermissionService", () => {
  let service: ToolPermissionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ToolPermissionService();
  });

  describe("State Management", () => {
    test("should initialize with default state", async () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [],
      );

      const state = await service.initialize();

      expect(state).toEqual({
        permissions: { policies: [] },
        currentMode: "default",
        isHeadless: false,
        modePolicyCount: 0,
      });
    });

    test("should initialize with runtime overrides", async () => {
      const mockPolicies: ToolPermissionPolicy[] = [
        { tool: "TestTool3", permission: "exclude" },
        { tool: "TestTool2", permission: "ask" },
        { tool: "TestTool1", permission: "allow" },
      ];

      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        mockPolicies,
      );

      const overrides = {
        allow: ["TestTool1"],
        ask: ["TestTool2"],
        exclude: ["TestTool3"],
      };

      const state = await service.initialize(overrides);

      expect(state.permissions.policies).toEqual(mockPolicies);
      expect(
        precedenceResolver.resolvePermissionPrecedence,
      ).toHaveBeenCalledWith({
        commandLineFlags: overrides,
        personalSettings: true,
        useDefaults: true,
      });
    });

    test("should initialize with specific mode", async () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [],
      );

      const state = await service.initialize({ mode: "plan" });

      expect(state.currentMode).toBe("plan");
      // Plan mode should have mode-specific policies
      expect(state.permissions.policies.length).toBeGreaterThan(0);
      expect(state.permissions.policies).toContainEqual({
        tool: "Write",
        permission: "exclude",
      });
    });
  });

  describe("initializeSync()", () => {
    test("should work synchronously for immediate availability", () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [{ tool: "Tool1", permission: "allow" }],
      );

      const state = service.initializeSync({ allow: ["Tool1"] });

      expect(state).toBeDefined();
      expect(state.permissions.policies).toContainEqual({
        tool: "Tool1",
        permission: "allow",
      });
    });

    test("should handle empty overrides", () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [{ tool: "*", permission: "allow" }],
      );

      const state = service.initializeSync({
        allow: [],
        ask: [],
        exclude: [],
      });

      // A user rule that allows everything is still narrowed by the tool's
      // own analysis; only the bypass table carries the override.
      expect(state.permissions.policies).toEqual([
        { tool: "*", permission: "allow" },
      ]);
    });
  });

  describe("Mode-specific policies", () => {
    test("should generate plan mode policies", () => {
      const state = service.initializeSync({ mode: "plan" });
      const policies = state.permissions.policies;

      // Write tools stay available for documentation and are narrowed by path
      expect(policies).toContainEqual({ tool: "Write", permission: "exclude" });
      expect(policies).toContainEqual({ tool: "Edit", permission: "exclude" });

      // Should allow read tools and inspecting shell commands, and only those
      expect(policies).toContainEqual({
        tool: "Bash",
        permission: "allow",
        readOnlyOnly: true,
      });
      expect(policies).toContainEqual({ tool: "Read", permission: "allow" });
      expect(policies).toContainEqual({ tool: "Search", permission: "allow" });
      expect(policies).toContainEqual({ tool: "List", permission: "allow" });

      // Plan mode leaves MCP and other tools at ask
      expect(policies[policies.length - 1]).toEqual({
        tool: "*",
        permission: "ask",
      });
    });

    test("should generate auto mode policies", () => {
      const state = service.initializeSync({ mode: "bypassPermissions" });

      expect(state.permissions.policies).toEqual([
        { tool: "*", permission: "allow", allowUnsafeCalls: true },
      ]);
    });

    test("should generate normal mode policies", () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [
          { tool: "Tool1", permission: "allow" },
          { tool: "Tool2", permission: "ask" },
        ],
      );

      const state = service.initializeSync({ mode: "default" });

      // Normal mode should use user configuration
      expect(state.permissions.policies).toEqual([
        { tool: "Tool1", permission: "allow" },
        { tool: "Tool2", permission: "ask" },
      ]);
      expect(state.modePolicyCount).toBe(0);
    });
  });

  describe("switchMode()", () => {
    beforeEach(() => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [
          { tool: "UserTool1", permission: "allow" },
          { tool: "UserTool2", permission: "exclude" },
        ],
      );
    });

    test("should switch from normal to plan mode", () => {
      service.initializeSync({ mode: "default" });

      const state = service.switchMode("plan");

      expect(state.currentMode).toBe("plan");
      // Should only have plan mode policies
      expect(state.permissions.policies).toContainEqual({
        tool: "Write",
        permission: "exclude",
      });
      // Should not have user policies
      expect(state.permissions.policies).not.toContainEqual({
        tool: "UserTool1",
        permission: "allow",
      });
    });

    test("should store original policies when leaving normal mode", () => {
      service.initializeSync({ mode: "default" });
      const originalState = service.getState();

      service.switchMode("plan");
      const planState = service.getState();

      // Should have stored original policies
      expect(planState.originalPolicies).toEqual({
        policies: originalState.permissions.policies,
      });
    });

    test("should restore original policies when switching back to normal", () => {
      // Start in normal with user policies
      service.initializeSync({ mode: "default" });
      const originalPolicies = service.getState().permissions.policies;

      // Switch to plan
      service.switchMode("plan");

      // Switch back to normal
      const state = service.switchMode("default");

      // Should restore original user policies
      expect(state.permissions.policies).toEqual(originalPolicies);
    });

    test("should handle multiple mode switches", () => {
      service.initializeSync({ mode: "default" });

      // Switch through all modes
      service.switchMode("plan");
      expect(service.getCurrentMode()).toBe("plan");

      service.switchMode("bypassPermissions");
      expect(service.getCurrentMode()).toBe("bypassPermissions");
      expect(service.getState().permissions.policies).toEqual([
        { tool: "*", permission: "allow", allowUnsafeCalls: true },
      ]);

      service.switchMode("default");
      expect(service.getCurrentMode()).toBe("default");
    });
  });

  describe("updatePermissions()", () => {
    test("should replace all policies", () => {
      service.initializeSync();

      const newPolicies: ToolPermissionPolicy[] = [
        { tool: "NewTool1", permission: "allow" },
        { tool: "NewTool2", permission: "ask" },
      ];

      service.updatePermissions(newPolicies);
      const state = service.getState();

      expect(state.permissions.policies).toEqual(newPolicies);
      expect(state.modePolicyCount).toBe(0);
    });
  });

  describe("getPermissions()", () => {
    test("should return current permissions", () => {
      service.initializeSync({ allow: ["TestTool"] });

      const permissions = service.getPermissions();
      const state = service.getState();

      // getState() returns a deep copy, so references won't match
      expect(permissions).toEqual(state.permissions);
      expect(permissions.policies).toEqual(state.permissions.policies);
    });
  });

  describe("getCurrentMode()", () => {
    test("should return current mode", () => {
      service.initializeSync({ mode: "plan" });
      expect(service.getCurrentMode()).toBe("plan");

      service.switchMode("bypassPermissions");
      expect(service.getCurrentMode()).toBe("bypassPermissions");
    });
  });

  describe("isReady()", () => {
    test("should always return true (service is always ready)", () => {
      // ToolPermissionService is designed to be always ready since it uses synchronous initialization
      expect(service.isReady()).toBe(true);
    });

    test("should return true after initialization", async () => {
      await service.initialize();
      expect(service.isReady()).toBe(true);
    });
  });

  describe("Event Emission", () => {
    test("should emit stateChanged when switching modes", () => {
      service.initializeSync({ mode: "default" });

      const listener = vi.fn();
      service.on("stateChanged", listener);

      service.switchMode("plan");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ currentMode: "plan" }),
        expect.objectContaining({ currentMode: "default" }),
      );
    });

    test("should emit stateChanged when updating permissions", () => {
      service.initializeSync();

      const listener = vi.fn();
      service.on("stateChanged", listener);

      const newPolicies: ToolPermissionPolicy[] = [
        { tool: "NewTool", permission: "allow" },
      ];
      service.updatePermissions(newPolicies);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: { policies: newPolicies },
        }),
        expect.any(Object),
      );
    });
  });

  describe("Mode Override Behavior", () => {
    test("plan mode should completely override user policies", () => {
      // Initialize with user policies that would allow writes
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [
          { tool: "Write", permission: "allow" },
          { tool: "Edit", permission: "allow" },
        ],
      );

      const state = service.initializeSync({
        mode: "plan",
        allow: ["Write", "Edit"],
      });

      // Plan mode should override the user preference and narrow these tools
      // to documentation paths
      expect(state.permissions.policies).toContainEqual({
        tool: "Write",
        permission: "exclude",
      });
      expect(state.permissions.policies).toContainEqual({
        tool: "Edit",
        permission: "exclude",
      });
    });

    test("auto mode should completely override user policies", () => {
      // Initialize with user policies that would exclude tools
      const state = service.initializeSync({
        mode: "bypassPermissions",
        exclude: ["DangerousTool"],
      });

      // Auto mode should override and allow everything
      expect(state.permissions.policies).toEqual([
        { tool: "*", permission: "allow", allowUnsafeCalls: true },
      ]);
    });
  });

  describe("Headless Mode Behavior", () => {
    test("should keep the headless flag out of the precedence call", () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [],
      );

      const state = service.initializeSync({ isHeadless: true });
      const call = vi
        .mocked(precedenceResolver.resolvePermissionPrecedence)
        .mock.calls.at(-1)?.[0];

      // The default table no longer varies by mode; headless is enforced by
      // dropping ask tools and refusing a call that reaches approval.
      expect("isHeadless" in (call ?? {})).toBe(false);
      expect(state.isHeadless).toBe(true);
    });

    test("should treat an interactive run the same way", () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [],
      );

      const state = service.initializeSync({ isHeadless: false });
      const call = vi
        .mocked(precedenceResolver.resolvePermissionPrecedence)
        .mock.calls.at(-1)?.[0];

      expect("isHeadless" in (call ?? {})).toBe(false);
      expect(state.isHeadless).toBe(false);
    });

    test("should apply plan mode policies in headless plan mode", () => {
      const state = service.initializeSync({
        isHeadless: true,
        mode: "plan",
      });

      // Plan mode should narrow write tools to documentation paths
      const writeDocsOnlyIndex = state.permissions.policies.findIndex(
        (p) => p.tool === "Write" && p.permission === "exclude",
      );
      expect(writeDocsOnlyIndex).toBeGreaterThanOrEqual(0);

      // Plan mode leaves all other tools at ask
      expect(state.permissions.policies).toContainEqual({
        tool: "*",
        permission: "ask",
      });
      expect(state.isHeadless).toBe(true);
    });

    test("should apply auto mode policies in headless auto mode", () => {
      const state = service.initializeSync({
        isHeadless: true,
        mode: "bypassPermissions",
      });

      // Auto mode has wildcard allow
      expect(state.permissions.policies).toContainEqual({
        tool: "*",
        permission: "allow",
        allowUnsafeCalls: true,
      });
      expect(state.isHeadless).toBe(true);
    });

    test("should have modePolicyCount of 0 in normal mode regardless of headless", () => {
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        [],
      );

      const headlessState = service.initializeSync({ isHeadless: true });
      expect(headlessState.modePolicyCount).toBe(0);

      const nonHeadlessService = new ToolPermissionService();
      const nonHeadlessState = nonHeadlessService.initializeSync({
        isHeadless: false,
      });
      expect(nonHeadlessState.modePolicyCount).toBe(0);
    });
  });

  describe("reloadPermissions", () => {
    test("should reload permissions from files in normal mode", async () => {
      const mockPolicies = [
        { tool: "Edit", permission: "allow" as const },
        { tool: "Write", permission: "ask" as const },
      ];

      // Mock the precedence resolver to return fresh policies
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        mockPolicies,
      );

      const service = new ToolPermissionService();
      service.initializeSync({ mode: "default" });

      // Verify initial state
      expect(service.getPermissions().policies).toEqual(mockPolicies);

      // Simulate new policies being added to the file
      const newMockPolicies = [
        ...mockPolicies,
        { tool: "Read", permission: "allow" as const },
      ];
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockReturnValue(
        newMockPolicies,
      );

      // Reload permissions
      await service.reloadPermissions();

      // Verify policies were reloaded
      expect(service.getPermissions().policies).toEqual(newMockPolicies);
      expect(
        precedenceResolver.resolvePermissionPrecedence,
      ).toHaveBeenCalledWith({
        personalSettings: true,
        useDefaults: true,
      });
    });

    test("should skip reload in non-normal modes", async () => {
      const service = new ToolPermissionService();
      service.initializeSync({ mode: "plan" });

      const initialPolicies = service.getPermissions().policies;

      // Clear the mock call count
      vi.mocked(precedenceResolver.resolvePermissionPrecedence).mockClear();

      // Try to reload
      await service.reloadPermissions();

      // Verify no reload happened
      expect(service.getPermissions().policies).toEqual(initialPolicies);
      expect(
        precedenceResolver.resolvePermissionPrecedence,
      ).not.toHaveBeenCalled();
    });
  });
});
