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
  it("draws the T wordmark, the version and the model", () => {
    // The shell that runs the suite may export NO_COLOR; the plate is the
    // colour path, so the test asks for it explicitly.
    vi.stubEnv("NO_COLOR", "");
    const tree = render(<BrandBanner version="1.2.3" />);
    try {
      const frame = tree.lastFrame() ?? "";
      // Four-row wordmark on the left, no border.
      expect(frame).toContain("███████  ██   ██  ███████");
      expect(frame).not.toContain("╭");
      // Name and version share the top metadata line (marginTop leaves a
      // blank first line).
      const firstLine = frame.split("\n").find((line) => line.trim()) ?? "";
      expect(firstLine).toContain("TNT CLI");
      expect(firstLine).toContain("v1.2.3");
      // Top-left: the wordmark starts at the first column (after padding).
      expect(firstLine.indexOf("█")).toBeLessThanOrEqual(2);
    } finally {
      tree.unmount();
    }
  });
});
