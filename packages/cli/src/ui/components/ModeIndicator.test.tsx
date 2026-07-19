import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServices, services } from "../../services/index.js";
import { darkTheme } from "../theme/tokens.js";

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
        mode: "auto",
      },
    });
  });

  describe("mode display", () => {
    it("shows Auto for the startup mode", () => {
      const { lastFrame } = track(<ModeIndicator />);
      expect(lastFrame()).toContain("[Auto]");
    });

    it("labels every menu mode", () => {
      expect(modeBadge("default").label).toBe("Manual");
      expect(modeBadge("acceptEdits").label).toBe("Accept edits");
      expect(modeBadge("plan").label).toBe("Plan");
      expect(modeBadge("auto").label).toBe("Auto");
      expect(modeBadge("bypassPermissions").label).toBe("Bypass permissions");
    });

    it("gives each badge its mode colour for the border", () => {
      expect(modeBorderColor("default", darkTheme)).toBe(
        darkTheme.text.primary,
      );
      expect(modeBorderColor("acceptEdits", darkTheme)).toBe(
        darkTheme.border.focus,
      );
      expect(modeBorderColor("plan", darkTheme)).toBe(darkTheme.accent);
      expect(modeBorderColor("auto", darkTheme)).toBe(darkTheme.status.success);
      expect(modeBorderColor("bypassPermissions", darkTheme)).toBe(
        darkTheme.status.error,
      );
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
      expect(lastFrame()).toContain("[Auto]");

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
