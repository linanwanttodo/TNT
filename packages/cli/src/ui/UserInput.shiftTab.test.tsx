import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { UserInput } from "./UserInput.js";

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/**
 * Shift+Tab cycles every interactive mode in place, the way it did before the
 * menu detour.
 */
describe("UserInput Shift+Tab cycle", () => {
  const renderInput = async () => {
    const tree = render(
      <UserInput
        onSubmit={vi.fn()}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />,
    );
    await tick();
    return tree;
  };

  beforeEach(async () => {
    await services.toolPermissions.doInitialize({ mode: "default" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("walks Manual -> Accept edits -> Plan -> Auto -> Bypass -> Manual", async () => {
    const tree = await renderInput();
    try {
      const badges: string[] = [];
      badges.push(tree.lastFrame() ?? "");
      for (let i = 0; i < 5; i += 1) {
        tree.stdin.write("\x1b[Z");
        await tick();
        badges.push(tree.lastFrame() ?? "");
      }

      expect(badges[1]).toContain("[Accept edits]");
      expect(badges[2]).toContain("[Plan]");
      expect(badges[3]).toContain("[Auto]");
      expect(badges[4]).toContain("[Bypass permissions]");
      expect(badges[5]).toContain("[Manual]");
      // The menu is gone: no entries, no navigation hint.
      expect(badges[1]).not.toContain("Ask before writes and commands");
      expect(badges[1]).not.toContain("Esc to cancel");
    } finally {
      tree.unmount();
    }
  });
});
