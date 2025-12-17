import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { IntroMessage } from "./IntroMessage.js";

vi.mock("../startup/asciiArt.js", () => ({
  getDisplayableAsciiArt: () => "MOCK ASCII ART",
}));

function frameOf(element: React.ReactElement): string | undefined {
  const tree = render(element);
  const frame = tree.lastFrame();
  tree.unmount();
  return frame;
}

describe("IntroMessage", () => {
  it("renders the ASCII art", () => {
    expect(frameOf(<IntroMessage />)).toContain("MOCK ASCII ART");
  });

  it("leaves Org, Config and Model to the status bar", () => {
    const frame = frameOf(<IntroMessage />) ?? "";

    expect(frame).not.toContain("Org:");
    expect(frame).not.toContain("Config:");
    expect(frame).not.toContain("Model:");
    expect(frame).not.toContain("Loading...");
  });
});
