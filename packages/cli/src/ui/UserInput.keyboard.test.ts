import { beforeEach, describe, expect, it } from "vitest";

import { services } from "../services/index.js";
const toolPermissionService = services.toolPermissions;
describe("UserInput Keyboard Shortcuts", () => {
  beforeEach(() => {
    // Reset to normal mode for each test
    toolPermissionService.initialize({});
  });

  describe("mode cycling logic", () => {
    it("should cycle through modes in correct order", () => {
      // Initially the default mode
      expect(toolPermissionService.getCurrentMode()).toBe("default");

      // Cycle to acceptEdits
      toolPermissionService.switchMode("acceptEdits");
      expect(toolPermissionService.getCurrentMode()).toBe("acceptEdits");

      // Cycle to plan
      toolPermissionService.switchMode("plan");
      expect(toolPermissionService.getCurrentMode()).toBe("plan");

      // Cycle back to default
      toolPermissionService.switchMode("default");
      expect(toolPermissionService.getCurrentMode()).toBe("default");
    });

    it("should cycle through the menu modes sequentially", () => {
      // Auto is refused until its classifier exists, and bypass is never in
      // the cycle, so the menu is these three modes.
      const modes = ["default", "acceptEdits", "plan"] as const;

      for (let i = 0; i < modes.length * 2; i++) {
        const expectedMode = modes[i % modes.length];
        toolPermissionService.switchMode(expectedMode);
        expect(toolPermissionService.getCurrentMode()).toBe(expectedMode);
      }
    });
  });
});
