import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { KeypressProvider } from "./contexts/KeypressContext.js";
import { UserInput } from "./UserInput.js";

/**
 * Typing at speed must never lose a character. The composer keeps the text in
 * a buffer behind React state, so a dropped key is invisible until the reader
 * notices a missing word - the worst possible failure for an input box.
 */
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderInput() {
  const tree = render(
    <KeypressProvider>
      <UserInput
        onSubmit={vi.fn()}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />
    </KeypressProvider>,
  );
  await tick();
  return tree;
}

describe("composer typing at speed", () => {
  it("keeps every character of one burst", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("abcdefghij");
      await tick(200);
      expect(tree.lastFrame() ?? "").toContain("abcdefghij");
    } finally {
      tree.unmount();
    }
  });

  it("keeps characters written without waiting for a frame", async () => {
    const tree = await renderInput();
    try {
      for (const char of "qwertyuiop") tree.stdin.write(char);
      await tick(300);
      expect(tree.lastFrame() ?? "").toContain("qwertyuiop");
    } finally {
      tree.unmount();
    }
  });

  it("keeps a burst that arrives while a command palette is open", async () => {
    const tree = await renderInput();
    try {
      tree.stdin.write("/");
      tree.stdin.write("he");
      await tick(200);
      expect(tree.lastFrame() ?? "").toContain("/he");
      tree.stdin.write("lp");
      await tick(200);
      expect(tree.lastFrame() ?? "").toContain("/help");
    } finally {
      tree.unmount();
    }
  });
});
