import { describe, expect, it } from "vitest";

import { scrollbarGeometry } from "./scrollbar.js";

describe("scrollbarGeometry", () => {
  it("hides the bar when the content fits the viewport", () => {
    expect(scrollbarGeometry(0, 10, 10)).toEqual({
      scrollable: false,
      trackHeight: 10,
      thumbTop: 0,
      thumbHeight: 0,
    });
  });

  it("scales the thumb to the viewport/content ratio", () => {
    const geometry = scrollbarGeometry(0, 10, 40);
    expect(geometry.scrollable).toBe(true);
    expect(geometry.thumbHeight).toBe(3); // round(100 / 40)
    expect(geometry.thumbTop).toBe(0);
  });

  it("keeps the thumb at least one row tall", () => {
    const geometry = scrollbarGeometry(0, 10, 10_000);
    expect(geometry.thumbHeight).toBe(1);
  });

  it("moves the thumb to the bottom at max scroll", () => {
    const geometry = scrollbarGeometry(30, 10, 40);
    expect(geometry.thumbTop).toBe(7); // track 10 - thumb 3
  });

  it("clamps the thumb inside the track on out-of-range offsets", () => {
    expect(scrollbarGeometry(-5, 10, 40).thumbTop).toBe(0);
    expect(scrollbarGeometry(999, 10, 40).thumbTop).toBe(7);
  });
});
