import fs from "fs";
import os from "os";
import path from "path";

import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketplaceConfigPath } from "../mcp/marketplace.js";

import { MCPMarketplace } from "./MCPMarketplace.js";

const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/**
 * The market writes mcp.json as you navigate: Enter installs the highlighted
 * server, the row gains an "installed" marker, and Esc leaves without touching
 * anything else.
 */
describe("MCPMarketplace", () => {
  const previousHome = process.env.CONTINUE_GLOBAL_DIR;
  let home: string;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-market-ui-"));
    process.env.CONTINUE_GLOBAL_DIR = home;
    onCancel = vi.fn();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.CONTINUE_GLOBAL_DIR;
    } else {
      process.env.CONTINUE_GLOBAL_DIR = previousHome;
    }
    vi.restoreAllMocks();
  });

  const servers = () =>
    JSON.parse(fs.readFileSync(marketplaceConfigPath(), "utf-8")).mcpServers;

  it("adds the highlighted server on enter", async () => {
    const tree = render(<MCPMarketplace onCancel={onCancel} />);
    try {
      expect(tree.lastFrame() ?? "").toContain("MCP marketplace");

      tree.stdin.write("\r");
      await tick();

      expect(servers().filesystem.command).toBe("npx");
      expect(tree.lastFrame() ?? "").toContain("Added Filesystem");
      expect(tree.lastFrame() ?? "").toContain("installed");
    } finally {
      tree.unmount();
    }
  });

  it("walks the catalog and reports the env a server needs", async () => {
    const tree = render(<MCPMarketplace onCancel={onCancel} />);
    try {
      tree.stdin.write("\x1b[B"); // down to GitHub
      await tick();
      tree.stdin.write("\r");
      await tick();

      expect(servers().github.env).toEqual({
        GITHUB_PERSONAL_ACCESS_TOKEN: "",
      });
      expect(tree.lastFrame() ?? "").toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    } finally {
      tree.unmount();
    }
  });

  it("escape closes without installing", async () => {
    const tree = render(<MCPMarketplace onCancel={onCancel} />);
    try {
      tree.stdin.write("\x1b");
      await tick();
      expect(onCancel).toHaveBeenCalled();
      expect(fs.existsSync(marketplaceConfigPath())).toBe(false);
    } finally {
      tree.unmount();
    }
  });
});
