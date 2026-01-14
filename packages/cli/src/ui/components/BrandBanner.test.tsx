import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { BrandBanner } from "./BrandBanner.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24, isResizing: false }),
}));

describe("BrandBanner", () => {
  it("draws the gradient T, the pixel word, the version and the tip", () => {
    const tree = render(<BrandBanner version="1.2.3" />);
    try {
      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("╭");
      expect(frame).toContain("██████");
      expect(frame).toContain("█   █");
      expect(frame).toContain("v1.2.3");
      expect(frame).not.toContain("Tip:");
      // Top-left, not centred: the panel's first line starts at the margin.
      const firstLine = frame.split("\n").find((line) => line.includes("╭"));
      expect(firstLine?.search(/╭/)).toBeLessThanOrEqual(1);
    } finally {
      tree.unmount();
    }
  });
});
