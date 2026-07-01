import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserInput } from "./UserInput.js";

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => []),
}));

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The auto-theme probe used to run after Ink owned stdin, so a terminal's OSC
 * reply (`ESC]11;rgb:...ESC\`) lost its ESC and was typed into the composer.
 * The probe now runs before the first render; these cases pin the composer's
 * side of the contract: it starts clean, ordinary text (including "]") still
 * works, and the ESC-stripped paste markers enter paste mode.
 */
describe("UserInput terminal responses", () => {
  let onSubmit: ReturnType<typeof vi.fn>;

  const renderInput = () => {
    return render(
      <UserInput
        onSubmit={onSubmit}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />,
    );
  };

  beforeEach(() => {
    onSubmit = vi.fn();
  });

  it("starts clean, types, and submits", async () => {
    const tree = renderInput();
    try {
      await tick();
      expect(tree.lastFrame() ?? "").not.toContain("]11;rgb");

      tree.stdin.write("abc");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("abc");

      tree.stdin.write("\r");
      await tick();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0]?.[0]).toBe("abc");
    } finally {
      tree.unmount();
    }
  });

  it("keeps a literal right bracket the user types", async () => {
    const tree = renderInput();
    try {
      await tick();

      tree.stdin.write("]");
      await tick();
      tree.stdin.write("abc");
      await tick();

      expect(tree.lastFrame() ?? "").toContain("]abc");
    } finally {
      tree.unmount();
    }
  });

  it("drops a late OSC 11 reply written to stdin", async () => {
    const tree = renderInput();
    try {
      await tick();

      tree.stdin.write("\x1b]11;rgb:0000/0000/0000\x1b\\");
      await tick();
      expect(tree.lastFrame() ?? "").not.toContain("rgb:");

      tree.stdin.write("abc");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("abc");
    } finally {
      tree.unmount();
    }
  });

  it("routes ESC-stripped paste markers into paste mode", async () => {
    const tree = renderInput();
    try {
      await tick();

      tree.stdin.write("\x1b[200~");
      await tick();
      tree.stdin.write("hello");
      await tick();
      expect(tree.lastFrame() ?? "").not.toContain("hello");

      tree.stdin.write("\x1b[201~");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("hello");
    } finally {
      tree.unmount();
    }
  });
});
