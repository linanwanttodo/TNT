import fs from "fs";
import path from "path";

import { logger } from "../utils/logger.js";

import { env } from "./env.js";
import { isProjectTrusted } from "./trust.js";

/**
 * MCP server definitions live in mcp.json, separate from models and rules.
 * Each file is `{ "mcpServers": { "<name>": { command, args, env } } }`; the
 * user file loads first and a trusted project file overrides a server with the
 * same name. The root `.mcp.json` is the Claude-compatible project file and is
 * read-only here, like the `.claude/settings.json` layer.
 */
export function mcpJsonPaths(cwd: string = process.cwd()): string[] {
  const files = [path.join(env.continueHome, "mcp.json")];
  if (isProjectTrusted(cwd)) {
    files.push(path.join(cwd, ".tnt", "mcp.json"));
    files.push(path.join(cwd, ".mcp.json"));
  }
  return files;
}

export function readMcpJsonFile(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      logger.warn("Invalid mcp.json structure", { path: file });
      return null;
    }
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      logger.warn("mcp.json has no mcpServers object", { path: file });
      return null;
    }
    return servers as Record<string, unknown>;
  } catch (error) {
    logger.warn("Failed to load mcp.json", { error, path: file });
    return null;
  }
}

/**
 * Every configured server, keyed by name; a later file replaces an earlier one
 * per name rather than replacing the whole file.
 */
export function loadMcpJsonServers(
  cwd: string = process.cwd(),
): Array<Record<string, unknown> & { name: string }> {
  const merged = new Map<string, Record<string, unknown> & { name: string }>();

  for (const file of mcpJsonPaths(cwd)) {
    const servers = readMcpJsonFile(file);
    if (!servers) continue;
    for (const [name, config] of Object.entries(servers)) {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        logger.warn("Ignoring a non-object MCP server entry", { file, name });
        continue;
      }
      merged.set(name, { ...(config as Record<string, unknown>), name });
    }
  }

  return [...merged.values()];
}
