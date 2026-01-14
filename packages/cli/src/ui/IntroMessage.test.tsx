import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntroMessage } from "./IntroMessage.js";

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24, isResizing: false }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

function frameOf(element: React.ReactElement): string | undefined {
  const tree = render(element);
  const frame = tree.lastFrame();
  tree.unmount();
  return frame;
}

describe("IntroMessage", () => {
  it("renders the brand plate", () => {
    vi.stubEnv("NO_COLOR", "");
    const frame = frameOf(<IntroMessage />) ?? "";
    expect(frame).toContain("██████");
    expect(frame).not.toContain("Tip:");
  });

  it("leaves Org, Config and Model to the status bar", () => {
    const frame = frameOf(<IntroMessage />) ?? "";

    expect(frame).not.toContain("Org:");
    expect(frame).not.toContain("Config:");
    expect(frame).not.toContain("Model:");
    expect(frame).not.toContain("Loading...");
  });
});
