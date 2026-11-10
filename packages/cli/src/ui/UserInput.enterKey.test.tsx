import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { splitTrailingEnter } from "../utils/coalescedEnter.js";

import { UserInput } from "./UserInput.js";

describe("splitTrailingEnter", () => {
  it("separates typed text from the return that ends it", () => {
    expect(splitTrailingEnter("hello\r")).toEqual({ body: "hello" });
    expect(splitTrailingEnter("hello\n")).toEqual({ body: "hello" });
    expect(splitTrailingEnter("hello\r\n")).toEqual({ body: "hello" });
    expect(splitTrailingEnter("你好\r")).toEqual({ body: "你好" });
  });

  it("keeps pasted line breaks in the text", () => {
    expect(splitTrailingEnter("line1\nline2")).toBeNull();
    expect(splitTrailingEnter("line1\nline2\n")).toBeNull();
    expect(splitTrailingEnter("hello")).toBeNull();
  });
});

describe("UserInput coalesced return", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mount = (onSubmit: (text: string) => void) =>
    render(
      <UserInput
        onSubmit={onSubmit}
        inputMode={true}
        disabled={false}
        isWaitingForResponse={false}
      />,
    );

  it("submits when the terminal delivers text and Enter in one read", () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("hello\r");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toBe("hello");
    } finally {
      tree.unmount();
    }
  });

  it("submits a lone newline as Enter, the way some terminals send it", () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("hello");
      tree.stdin.write("\n");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toBe("hello");
    } finally {
      tree.unmount();
    }
  });

  it("keeps a multi-line paste in the buffer instead of sending it", async () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("line1\nline2");
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(tree.lastFrame() ?? "").toContain("line2");
    } finally {
      tree.unmount();
    }
  });
});
