import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntroMessage } from "./IntroMessage.js";

// Mock other dependencies
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ASCII art and basic structure", () => {
    const frame = frameOf(<IntroMessage />);

    expect(frame).toContain("MOCK ASCII ART");
  });

  it("renders config name when config is provided", () => {
    const config = { name: "Test Agent", version: "1.0.0", rules: [] };

    const frame = frameOf(<IntroMessage config={config} />);

    expect(frame).toContain("Config:");
    expect(frame).toContain("Test Agent");
  });

  it("renders model information when model is provided", () => {
    const model = {
      name: "provider/model-name",
      provider: "test-provider",
      model: "test-model",
    };

    const frame = frameOf(<IntroMessage model={model} />);

    expect(frame).toContain("Model:");
    expect(frame).toContain("model-name");
  });

  it("shows loading state when model is not provided", () => {
    const frame = frameOf(<IntroMessage />);

    expect(frame).toContain("Model:");
    expect(frame).toContain("Loading...");
  });

  it("renders organization name when provided", () => {
    const frame = frameOf(
      <IntroMessage organizationName="Test Organization" />,
    );

    expect(frame).toContain("Org:");
    expect(frame).toContain("Test Organization");
  });

  it("does not render organization section when not provided", () => {
    const frame = frameOf(<IntroMessage />);

    expect(frame).not.toContain("Org:");
  });
});
