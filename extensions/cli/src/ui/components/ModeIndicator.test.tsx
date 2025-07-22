import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeServices, services } from "src/services/index.js";

import { ModeIndicator } from "./ModeIndicator.js";

describe("ModeIndicator", () => {
  const toolPermissionService = services.toolPermissions;

  beforeEach(async () => {
    await initializeServices({
      headless: true,
      toolPermissionOverrides: {
        mode: "agent",
      },
    });
  });

  describe("mode display", () => {
    it("does not render anything for normal mode", () => {
      const { lastFrame } = render(<ModeIndicator />);
      expect(lastFrame()).toBe("");
    });

    it("displays plan mode", () => {
      const { lastFrame } = render(<ModeIndicator mode="plan" />);
      expect(lastFrame()).toContain("plan]");
    });

    it("displays auto mode", () => {
      const { lastFrame } = render(<ModeIndicator mode="auto" />);
      expect(lastFrame()).toContain("auto]");
    });

    it("uses service mode when no mode prop is provided", () => {
      toolPermissionService.switchMode("plan");
      const { lastFrame } = render(<ModeIndicator />);
      expect(lastFrame()).toContain("plan]");
    });

    it("prioritizes the mode prop over service mode", () => {
      toolPermissionService.switchMode("plan");
      const { lastFrame } = render(<ModeIndicator mode="auto" />);
      expect(lastFrame()).toContain("auto]");
    });
  });

  describe("mode changes", () => {
    it("updates when the service mode changes", () => {
      const { lastFrame, rerender } = render(<ModeIndicator />);
      expect(lastFrame()).toBe("");

      toolPermissionService.switchMode("plan");
      rerender(<ModeIndicator />);
      expect(lastFrame()).toContain("plan]");

      toolPermissionService.switchMode("auto");
      rerender(<ModeIndicator />);
      expect(lastFrame()).toContain("auto]");

      toolPermissionService.switchMode("agent");
      rerender(<ModeIndicator />);
      expect(lastFrame()).toBe("");
    });
  });
});
