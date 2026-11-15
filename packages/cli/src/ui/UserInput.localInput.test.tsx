import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

function mount(onSubmit: (text: string) => void) {
  return render(
    <KeypressProvider>
      <UserInput
        onSubmit={onSubmit}
        inputMode={true}
        disabled={false}
        isWaitingForResponse={false}
      />
    </KeypressProvider>,
  );
}

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

describe("local composer input", () => {
  it("keeps a bare slash editable instead of freezing on the command palette", async () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("/");
      await tick();
      expect(tree.lastFrame()).toContain("/");
      tree.stdin.write("help");
      await tick();
      expect(tree.lastFrame()).toContain("/help");
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      tree.unmount();
    }
  });

  it("submits an IME Chinese commit followed by Enter in a separate read", async () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      // The terminal delivers the composed run and the confirming Enter as
      // two reads; the fast-return guard only rewrites an Enter inside the
      // same burst.
      tree.stdin.write("修复登录");
      await tick();
      expect(tree.lastFrame()).toContain("修复登录");
      tree.stdin.write("\r");
      await tick();
      expect(onSubmit).toHaveBeenCalledWith("修复登录", expect.anything());
    } finally {
      tree.unmount();
    }
  });

  it("does not delay a normal CJK character behind rapid-paste buffering", async () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("你");
      await tick();
      expect(tree.lastFrame()).toContain("你");
      tree.stdin.write("好");
      await tick();
      expect(tree.lastFrame()).toContain("你好");
      tree.stdin.write("\r");
      await tick();
      expect(onSubmit).toHaveBeenCalledWith("你好", expect.anything());
    } finally {
      tree.unmount();
    }
  });

  it("submits a plain slash command without Enter selecting an unintended palette row", async () => {
    const onSubmit = vi.fn();
    const tree = mount(onSubmit);

    try {
      tree.stdin.write("/help");
      await tick();
      expect(tree.lastFrame()).toContain("/help");
      tree.stdin.write("\r");
      await tick();
      // The slash palette runs the command with a single argument; only
      // the normal composer submit also carries the image map.
      expect(onSubmit).toHaveBeenCalledWith("/help");
    } finally {
      tree.unmount();
    }
  });
});
