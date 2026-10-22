import fs from "fs";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { env } from "../config/env.js";

/**
 * A curated set of MCP servers offered by `/mcp market`. Entries are written
 * to mcp.json in the same shape another Claude-compatible client uses -
 * `mcpServers.<name>` with `command`/`args`/`env` - so either client can read
 * a file the other wrote.
 */
export interface MarketplaceServer {
  /** Key under `mcpServers`. */
  name: string;
  title: string;
  description: string;
  command: string;
  args: string[];
  /** Environment variables the server needs; written as empty placeholders. */
  envKeys?: string[];
  homepage?: string;
}

export const MCP_MARKETPLACE: MarketplaceServer[] = [
  {
    name: "filesystem",
    title: "Filesystem",
    description: "Read and write files inside the directories you allow",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "<cwd>"],
  },
  {
    name: "github",
    title: "GitHub",
    description: "Repositories, issues and pull requests",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    name: "memory",
    title: "Memory",
    description: "A persistent knowledge graph for the assistant",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    name: "sequential-thinking",
    title: "Sequential thinking",
    description: "Structured step-by-step reasoning helper",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    name: "fetch",
    title: "Fetch",
    description: "Fetch a URL and convert it for the model",
    command: "uvx",
    args: ["mcp-server-fetch"],
  },
  {
    name: "time",
    title: "Time",
    description: "Current time and timezone conversion",
    command: "uvx",
    args: ["mcp-server-time"],
  },
  {
    name: "puppeteer",
    title: "Puppeteer",
    description: "Drive a headless browser",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
  },
];

export function marketplaceConfigPath(home: string = env.continueHome): string {
  return path.join(home, "mcp.json");
}

/** Names already present in the user's mcp.json. */
export function installedMarketplaceNames(
  home: string = env.continueHome,
): Set<string> {
  try {
    const file = marketplaceConfigPath(home);
    if (!fs.existsSync(file)) return new Set();
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const servers = parsed?.mcpServers;
    return new Set(
      servers && typeof servers === "object" ? Object.keys(servers) : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Adds (or replaces) one server in the user's mcp.json. Other servers and
 * unknown top-level keys are preserved; the write is atomic.
 */
export function installMarketplaceServer(
  server: MarketplaceServer,
  home: string = env.continueHome,
): string {
  const file = marketplaceConfigPath(home);
  let document: Record<string, unknown> = {};
  try {
    if (fs.existsSync(file)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        document = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // A malformed file is replaced, not silently merged into.
    document = {};
  }

  const servers =
    document.mcpServers &&
    typeof document.mcpServers === "object" &&
    !Array.isArray(document.mcpServers)
      ? (document.mcpServers as Record<string, unknown>)
      : {};

  servers[server.name] = {
    command: server.command,
    args: server.args.map((arg) => (arg === "<cwd>" ? process.cwd() : arg)),
    ...(server.envKeys?.length
      ? {
          env: Object.fromEntries(server.envKeys.map((key) => [key, ""])),
        }
      : {}),
  };

  document.mcpServers = servers;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomically(file, `${JSON.stringify(document, null, 2)}\n`);
  return file;
}
