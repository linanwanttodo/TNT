import { describe, expect, test } from "vitest";

import {
  getServiceSync,
  initializeServices,
  SERVICE_NAMES,
  serviceContainer,
} from "../services/index.js";
import type { ToolPermissionServiceState } from "../services/ToolPermissionService.js";

import { getRequestTools } from "./handleToolCalls.js";

describe("getRequestTools - Tool Filtering", () => {
  beforeEach(() => {
    // Clean up service container state before each test
    Object.values(SERVICE_NAMES).forEach((service) => {
      // Reset service state
      (serviceContainer as any).services.delete(service);
      (serviceContainer as any).factories.delete(service);
      (serviceContainer as any).dependencies.delete(service);
    });
  });

  test("should exclude Bash tool in plan mode after service initialization", async () => {
    // Initialize services in plan mode (simulating `tnt -p`)
    await initializeServices({
      headless: false,
      toolPermissionOverrides: {
        mode: "plan",
      },
    });

    // Verify service is ready
    const serviceResult = getServiceSync<ToolPermissionServiceState>(
      SERVICE_NAMES.TOOL_PERMISSIONS,
    );
    expect(serviceResult.state).toBe("ready");
    expect(serviceResult.value?.currentMode).toBe("plan");

    // Get available tools - this should include Bash in plan mode
    const tools = await getRequestTools(false);
    const toolNames = tools.map((t) => t.function.name);

    // Bash should be allowed in plan mode
    expect(toolNames).toContain("Bash");

    // Read-only tools should still be available
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("List");
    expect(toolNames).toContain("Fetch");
    expect(toolNames).toContain("Checklist");

    // The write tools are excluded in plan mode, so they are not offered.
    expect(toolNames).not.toContain("Write");
    expect(toolNames).not.toContain("Edit");
  });

  test("should include Bash tool in normal mode", async () => {
    // Initialize services in normal mode
    await initializeServices({
      headless: false,
      toolPermissionOverrides: {
        mode: "default",
      },
    });

    // Verify service is ready
    const serviceResult = getServiceSync<ToolPermissionServiceState>(
      SERVICE_NAMES.TOOL_PERMISSIONS,
    );
    expect(serviceResult.state).toBe("ready");
    expect(serviceResult.value?.currentMode).toBe("default");

    // Get available tools - Bash should be available in normal mode
    const tools = await getRequestTools(false);
    const toolNames = tools.map((t) => t.function.name);

    // All tools should be available in normal mode
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");
    expect(toolNames).toContain("MultiEdit");
  });

  test("should include all tools in auto mode", async () => {
    // Initialize services in auto mode
    await initializeServices({
      headless: false,
      toolPermissionOverrides: {
        mode: "bypassPermissions",
      },
    });

    // Verify service is ready
    const serviceResult = getServiceSync<ToolPermissionServiceState>(
      SERVICE_NAMES.TOOL_PERMISSIONS,
    );
    expect(serviceResult.state).toBe("ready");
    expect(serviceResult.value?.currentMode).toBe("bypassPermissions");

    // Get available tools - all tools should be available in auto mode
    const tools = await getRequestTools(false);
    const toolNames = tools.map((t) => t.function.name);

    // All tools should be available in auto mode
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");
    expect(toolNames).toContain("MultiEdit");
  });

  test("should respect explicit exclude in normal mode", async () => {
    // Initialize services in normal mode with Read tool explicitly excluded
    await initializeServices({
      headless: false,
      toolPermissionOverrides: {
        mode: "default",
        exclude: ["Read"],
      },
    });

    const tools = await getRequestTools(false);
    const toolNames = tools.map((t) => t.function.name);

    // Read should be excluded due to explicit exclude
    expect(toolNames).not.toContain("Read");

    // Other tools should still be available in normal mode
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Write");
    expect(toolNames).toContain("List");
  });

  test("plan mode should override allow flags (regression test for GitHub Actions issue)", async () => {
    // This test specifically addresses the original issue where plan mode
    // wasn't properly excluding tools despite being in plan mode
    await initializeServices({
      headless: false,
      toolPermissionOverrides: {
        mode: "plan",
        allow: ["Write", "Edit"], // These should be ignored in plan mode
      },
    });

    const tools = await getRequestTools(false);
    const toolNames = tools.map((t) => t.function.name);

    // Plan mode policies have absolute precedence: the write tools are
    // excluded rather than allowed, whatever the user flags asked for
    const permissionState = getServiceSync<ToolPermissionServiceState>(
      SERVICE_NAMES.TOOL_PERMISSIONS,
    );
    const writePolicy = permissionState.value?.permissions.policies.find(
      (policy) => policy.tool === "Write",
    );
    expect(writePolicy?.permission).toBe("exclude");
    expect(toolNames).not.toContain("Write");
    expect(toolNames).not.toContain("Edit");

    // Bash should be available in plan mode
    expect(toolNames).toContain("Bash");

    // Read-only tools should be available
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("List");
  });

  test("returns the same tool list in the same order on every turn", async () => {
    await initializeServices({
      headless: false,
      toolPermissionOverrides: {
        mode: "default",
      },
    });

    const first = await getRequestTools(false);
    const second = await getRequestTools(false);

    // Tool order is part of the cached prefix: a list that reshuffles between
    // turns invalidates the provider cache even though nothing changed.
    expect(second).toEqual(first);
  });

  test("withholds ask tools in headless mode", async () => {
    await initializeServices({
      headless: true,
    });

    const tools = await getRequestTools(true);
    const toolNames = tools.map((t) => t.function.name);

    // A headless run cannot answer an ask, so those tools are not offered at
    // all. A caller that needs one opts it back in with --allow.
    expect(toolNames).not.toContain("Edit");
    expect(toolNames).not.toContain("Write");
    expect(toolNames).not.toContain("MultiEdit");
    expect(toolNames).not.toContain("Bash");
    expect(toolNames).toContain("Read");
  });

  test("offers a write tool in headless when --allow names it", async () => {
    await initializeServices({
      headless: true,
      toolPermissionOverrides: { allow: ["Write"] },
    });

    const toolNames = (await getRequestTools(true)).map((t) => t.function.name);

    expect(toolNames).toContain("Write");
    expect(toolNames).not.toContain("Bash");
  });
});
