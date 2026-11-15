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
      // Bare header: wordmark, version, model and the help pointer only.
      expect(frame).toContain("███████  ██   ██  ███████");
      expect(frame).toContain("TNT CLI v1.2.3");
      expect(frame).toContain("Send /help for help information.");
      expect(frame).not.toContain("╭");
      expect(frame).not.toContain("Directory:");
    } finally {
      tree.unmount();
    }
  });
});
