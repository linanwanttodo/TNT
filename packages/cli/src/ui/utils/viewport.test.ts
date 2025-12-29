import { describe, expect, it } from "vitest";

import { maxViewportScroll, viewportSpacer } from "./viewport.js";

describe("viewport math", () => {
  it("fills the leftover rows when the transcript is short", () => {
    expect(viewportSpacer(20, 8, 0)).toBe(12);
  });

  it("does not add a spacer when the transcript exactly fills the viewport", () => {
    expect(viewportSpacer(20, 20, 0)).toBe(0);
  });

  it("moves older lines into view by the scroll offset", () => {
    expect(viewportSpacer(20, 35, 6)).toBe(6);
  });

  it("caps the offset at the oldest content", () => {
    expect(maxViewportScroll(20, 35)).toBe(15);
    expect(viewportSpacer(20, 35, 99)).toBe(15);
  });

  it("treats a negative offset as the live end", () => {
    expect(viewportSpacer(20, 35, -4)).toBe(0);
  });

  it("never reports a negative scroll range", () => {
    expect(maxViewportScroll(20, 8)).toBe(0);
  });
});
