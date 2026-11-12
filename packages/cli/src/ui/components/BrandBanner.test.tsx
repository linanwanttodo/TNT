import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrandBanner } from "./BrandBanner.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24, isResizing: false }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BrandBanner", () => {
  it("draws the wordmark, the name and the version", () => {
    // The shell that runs the suite may export NO_COLOR; the plate is the
    // colour path, so the test asks for it explicitly.
    vi.stubEnv("NO_COLOR", "");
    const tree = render(<BrandBanner version="1.2.3" />);
    try {
      const frame = tree.lastFrame() ?? "";
      // The welcome facts live inside a rounded frame.
      expect(frame).toContain("╭");
      expect(frame).toContain("Welcome to TNT CLI!");
      expect(frame).toContain("Version:");
      expect(frame).toContain("v1.2.3");
      expect(frame).toContain("GitHub:");
      // A vertical rule separates the facts from the hint pane.
      expect(frame).toContain("│");
      // Hints fill the right pane.
      expect(frame).toContain("shift+tab 切换模式");
    } finally {
      tree.unmount();
    }
  });
});
