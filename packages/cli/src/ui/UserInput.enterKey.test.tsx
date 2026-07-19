import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { splitTrailingEnter } from "../utils/coalescedEnter.js";

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

import { KeypressProvider } from "./contexts/KeypressContext.js";
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
      <KeypressProvider>
        <UserInput
          onSubmit={onSubmit}
          inputMode={true}
          disabled={false}
          isWaitingForResponse={false}
        />
      </KeypressProvider>,
    );

  it("keeps a burst of text and Enter in the buffer, the fast-return guard", async () => {
    // A read that carries typed text plus its Enter is treated as an
    // unbracketed paste: the trailing Enter becomes a newline and the
    // content stays in the composer until a deliberate Enter sends it.
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("hello\r");
      await tick(60);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(tree.lastFrame()).toContain("hello");
      tree.stdin.write("\r");
      await tick(60);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toBe("hello");
    } finally {
      tree.unmount();
    }
  });

  it("inserts a bare newline as a line break, the way gemini's parser does", async () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("hello");
      await tick(60);
      tree.stdin.write("\n");
      await tick(60);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(tree.lastFrame()).toContain("hello");
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
