import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-helpers/ui-test-context.js";
import { AppRoot } from "../AppRoot.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 12, isResizing: false }),
}));

describe("TUIChat layout", () => {
  let context: ReturnType<typeof createUITestContext>;

  beforeEach(() => {
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });
  });

  afterEach(() => context.cleanup());

  it("keeps the composer at the terminal bottom when the intro is taller than the viewport", () => {
    const { lastFrame, unmount } = render(<AppRoot />);

    try {
      const lines = (lastFrame() ?? "").split("\n");
      expect(lines).toHaveLength(12);
      expect(lines[8]).toContain("╭");
      expect(lines[9]).toContain("Ask anything");
      expect(lines[10]).toContain("╰");
      expect(lines[11]).toContain("TNT");
    } finally {
      unmount();
    }
  });
});
