import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeServices, services } from "src/services/index.js";

import { ModeIndicator } from "./ModeIndicator.js";

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
        mode: "agent",
      },
    });
  });

  describe("mode display", () => {
    it("does not render anything for normal mode", () => {
      const { lastFrame } = track(<ModeIndicator />);
      expect(lastFrame()).toBe("");
    });

    it("displays plan mode", () => {
      const { lastFrame } = track(<ModeIndicator mode="plan" />);
      expect(lastFrame()).toContain("plan]");
    });

    it("displays auto mode", () => {
      const { lastFrame } = track(<ModeIndicator mode="auto" />);
      expect(lastFrame()).toContain("auto]");
    });

    it("uses service mode when no mode prop is provided", () => {
      toolPermissionService.switchMode("plan");
      const { lastFrame } = track(<ModeIndicator />);
      expect(lastFrame()).toContain("plan]");
    });

    it("prioritizes the mode prop over service mode", () => {
      toolPermissionService.switchMode("plan");
      const { lastFrame } = track(<ModeIndicator mode="auto" />);
      expect(lastFrame()).toContain("auto]");
    });
  });

  describe("mode changes", () => {
    it("updates when the service mode changes", () => {
      const { lastFrame, rerender } = track(<ModeIndicator />);
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
