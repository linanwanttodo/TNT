import { describe, it, expect, beforeEach } from "vitest";

import { ToolPermissionService } from "../services/ToolPermissionService.js";

import {
  DOCUMENT_ONLY_MODE_DENIAL,
  checkToolPermission,
} from "./permissionChecker.js";

describe("Permission Integration Tests", () => {
  let service: ToolPermissionService;

  beforeEach(() => {
    service = new ToolPermissionService();
  });

  describe("Headless mode with --allow flags", () => {
    it("should allow Edit tool when --allow Edit is specified in headless mode", () => {
      // Initialize service with headless mode and --allow Edit
      service.initializeSync({
        allow: ["Edit"],
        isHeadless: true,
      });

      const state = service.getState();

      // Check that the service is in headless mode
      expect(state.isHeadless).toBe(true);

      // Check permission for Edit tool
      const result = checkToolPermission(
        { name: "Edit", arguments: {} },
        state.permissions,
      );

      // Should be allowed because --allow Edit is specified
      expect(result.permission).toBe("allow");
    });

    it("should allow multiple tools with --allow in headless mode", () => {
      // Initialize service with headless mode and multiple --allow flags
      service.initializeSync({
        allow: ["Edit", "Write", "Bash"],
        isHeadless: true,
      });

      const state = service.getState();

      // Check Edit
      const editResult = checkToolPermission(
        { name: "Edit", arguments: {} },
        state.permissions,
      );
      expect(editResult.permission).toBe("allow");

      // Check Write
      const writeResult = checkToolPermission(
        { name: "Write", arguments: {} },
        state.permissions,
      );
      expect(writeResult.permission).toBe("allow");

      // Check Bash
      const bashResult = checkToolPermission(
        { name: "Bash", arguments: {} },
        state.permissions,
      );
      expect(bashResult.permission).toBe("allow");
    });

    it("should respect --exclude in headless mode", () => {
      service.initializeSync({
        allow: ["Read"],
        exclude: ["Edit"],
        isHeadless: true,
      });

      const state = service.getState();

      // Check that Read is allowed
      const readResult = checkToolPermission(
        { name: "Read", arguments: {} },
        state.permissions,
      );
      expect(readResult.permission).toBe("allow");

      // Check that Edit is excluded
      const editResult = checkToolPermission(
        { name: "Edit", arguments: {} },
        state.permissions,
      );
      expect(editResult.permission).toBe("exclude");
    });

    it("should allow documentation writes in plan mode", () => {
      // Plan mode writes documentation only, and the mode rule is what
      // applies even when the user allows Edit outright.
      service.initializeSync({
        mode: "plan",
        allow: ["Edit"],
        isHeadless: true,
      });

      const state = service.getState();

      const planWrite = checkToolPermission(
        { name: "Edit", arguments: { file_path: "notes/implementation.md" } },
        state.permissions,
      );
      expect(planWrite.permission).toBe("allow");

      const codeWrite = checkToolPermission(
        { name: "Edit", arguments: { file_path: "src/index.ts" } },
        state.permissions,
      );
      expect(codeWrite.permission).toBe("exclude");
      expect(codeWrite.reason).toBe(DOCUMENT_ONLY_MODE_DENIAL);
    });
  });
});
