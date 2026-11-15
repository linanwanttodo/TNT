import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUITestContext } from "../../test-utils/ui-test-context.js";
import { services } from "../services/index.js";

import { AppRoot } from "./AppRoot.js";

// The composer keys must survive the memo boundary that keeps the input row
// off the streaming render path: render the real tree, type "/", and complete
// with Tab the way a reader does.
vi.mock("./hooks/useTUIChatHooks.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIntroMessage: () => [true, vi.fn()] as const,
}));

vi.mock("./hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30, isResizing: false }),
}));

vi.mock("./commands/index.js", () => ({
  getAllSlashCommands: vi.fn(async () => [
    { name: "clear", description: "d1", category: "system" },
    { name: "help", description: "d5", category: "system" },
    { name: "model", description: "d6", category: "system" },
  ]),
}));

const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TUIChat composer keys", () => {
  let context: ReturnType<typeof createUITestContext>;

  beforeEach(async () => {
    vi.stubEnv("NO_COLOR", "");
    context = createUITestContext({
      allServicesReady: true,
      serviceState: "ready",
      serviceValue: { some: "data" },
    });
    await services.toolPermissions.doInitialize({ mode: "auto" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    context.cleanup();
  });

  it("completes /he with Tab through the memoized composer", async () => {
    const tree = render(<AppRoot />);
    try {
      await tick();
      tree.stdin.write("/");
      await tick();
      tree.stdin.write("he");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("/help");

      tree.stdin.write("\t");
      await tick(300);

      expect(tree.lastFrame() ?? "").toContain("/help");
    } finally {
      tree.unmount();
    }
  });
});
