import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MCP_MARKETPLACE,
  installMarketplaceServer,
  installedMarketplaceNames,
  marketplaceConfigPath,
} from "./marketplace.js";

/**
 * The market writes the same file shape another Claude-compatible client
 * reads, so the tests pin the exact structure, the merge behavior and the
 * fact that a malformed file is replaced rather than corrupted further.
 */
describe("MCP marketplace", () => {
  const previousHome = process.env.TNT_GLOBAL_DIR;
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-mcp-market-"));
    process.env.TNT_GLOBAL_DIR = home;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousHome;
    }
  });

  const readConfig = () =>
    JSON.parse(fs.readFileSync(marketplaceConfigPath(), "utf-8"));

  it("writes a server in the Claude-compatible mcpServers shape", () => {
    const server = MCP_MARKETPLACE.find((s) => s.name === "memory")!;
    installMarketplaceServer(server);

    const config = readConfig();
    expect(config.mcpServers.memory).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    });
  });

  it("resolves the workspace placeholder and env placeholders", () => {
    const fsServer = MCP_MARKETPLACE.find((s) => s.name === "filesystem")!;
    installMarketplaceServer(fsServer);
    expect(readConfig().mcpServers.filesystem.args).toContain(process.cwd());

    const github = MCP_MARKETPLACE.find((s) => s.name === "github")!;
    installMarketplaceServer(github);
    expect(readConfig().mcpServers.github.env).toEqual({
      GITHUB_PERSONAL_ACCESS_TOKEN: "",
    });
  });

  it("keeps other servers and unknown top-level keys", () => {
    fs.writeFileSync(
      marketplaceConfigPath(),
      JSON.stringify({
        mcpServers: { mine: { command: "my-server" } },
        other: { keep: true },
      }),
    );

    installMarketplaceServer(MCP_MARKETPLACE.find((s) => s.name === "memory")!);

    const config = readConfig();
    expect(config.other).toEqual({ keep: true });
    expect(Object.keys(config.mcpServers).sort()).toEqual(["memory", "mine"]);
    expect(installedMarketplaceNames()).toEqual(new Set(["memory", "mine"]));
  });

  it("replaces a malformed file instead of merging into it", () => {
    fs.writeFileSync(marketplaceConfigPath(), "{ not json");

    installMarketplaceServer(MCP_MARKETPLACE.find((s) => s.name === "memory")!);

    expect(Object.keys(readConfig().mcpServers)).toEqual(["memory"]);
  });
});
