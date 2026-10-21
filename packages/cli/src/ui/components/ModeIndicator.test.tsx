import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServices, services } from "src/services/index.js";

import { ModeIndicator, modeBadge, modeBorderColor } from "./ModeIndicator.js";

// A mounted indicator subscribes to the permission service on the shared
// container, so leaving it mounted keeps those handlers alive for every test
// that runs after it in this worker.
const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  for (const tree of mounted) tree.unmount();
  mounted.length = 0;
});

describe("ModeIndicator", () => {
  const toolPermissionService = services.toolPermissions;

  beforeEach(async () => {
    await initializeServices({
      headless: true,
      toolPermissionOverrides: {
        mode: "default",
      },
    });
  });

  describe("mode display", () => {
    it("shows Manual for the default mode", () => {
      const { lastFrame } = track(<ModeIndicator />);
      expect(lastFrame()).toContain("[Manual]");
    });

    it("labels every menu mode", () => {
      expect(modeBadge("default").label).toBe("Manual");
      expect(modeBadge("acceptEdits").label).toBe("Accept edits");
      expect(modeBadge("plan").label).toBe("Plan");
      expect(modeBadge("auto").label).toBe("Auto");
      expect(modeBadge("bypassPermissions").label).toBe("Bypass permissions");
    });

    it("gives each badge its mode colour for the border", () => {
      expect(modeBorderColor("default")).toBe("gray");
      expect(modeBorderColor("acceptEdits")).toBe("cyan");
      expect(modeBorderColor("plan")).toBe("blue");
      expect(modeBorderColor("auto")).toBe("green");
      expect(modeBorderColor("bypassPermissions")).toBe("red");
    });

    it("displays plan mode", () => {
      const { lastFrame } = track(<ModeIndicator mode="plan" />);
      expect(lastFrame()).toContain("[Plan]");
    });

    it("displays bypass mode", () => {
      const { lastFrame } = track(<ModeIndicator mode="bypassPermissions" />);
      expect(lastFrame()).toContain("[Bypass permissions]");
    });

    it("uses service mode when no mode prop is provided", () => {
      toolPermissionService.switchMode("plan");
      const { lastFrame } = track(<ModeIndicator />);
      expect(lastFrame()).toContain("[Plan]");
    });

    it("prioritizes the mode prop over service mode", () => {
      toolPermissionService.switchMode("plan");
      const { lastFrame } = track(<ModeIndicator mode="bypassPermissions" />);
      expect(lastFrame()).toContain("[Bypass permissions]");
    });
  });

  describe("mode changes", () => {
    it("updates when the service mode changes", () => {
      const { lastFrame, rerender } = track(<ModeIndicator />);
      expect(lastFrame()).toContain("[Manual]");

      toolPermissionService.switchMode("plan");
      rerender(<ModeIndicator />);
      expect(lastFrame()).toContain("[Plan]");

      toolPermissionService.switchMode("bypassPermissions");
      rerender(<ModeIndicator />);
      expect(lastFrame()).toContain("[Bypass permissions]");

      toolPermissionService.switchMode("default");
      rerender(<ModeIndicator />);
      expect(lastFrame()).toContain("[Manual]");
    });
  });
});
