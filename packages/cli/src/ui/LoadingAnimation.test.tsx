import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { LoadingAnimation, SPINNER_FRAMES } from "./LoadingAnimation.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

describe("LoadingAnimation", () => {
  it("draws a single braille cell rather than a cluster", () => {
    const frame = frameOf(<LoadingAnimation />);

    expect(frame).toBe(SPINNER_FRAMES[0]);
    expect([...frame]).toHaveLength(1);
  });

  it("draws nothing when hidden", () => {
    expect(frameOf(<LoadingAnimation visible={false} />)).toBe("");
  });

  it("has ten distinct one-cell frames", () => {
    expect(SPINNER_FRAMES).toHaveLength(10);
    expect(new Set(SPINNER_FRAMES).size).toBe(SPINNER_FRAMES.length);
    for (const frame of SPINNER_FRAMES) {
      expect([...frame]).toHaveLength(1);
    }
  });
});
