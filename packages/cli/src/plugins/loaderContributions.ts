import * as fs from "fs";
import * as path from "path";

import type {
  HookHandler,
  HookMatcherGroup,
  HookSettingsFile,
} from "../hooks/types.js";
import { logger } from "../utils/logger.js";

import type { LoadedPlugin } from "./manifest.js";
import {
  substitutePluginVariables,
  substitutePluginVariablesDeep,
} from "./manifest.js";

export interface PluginHooks {
  config: Record<string, HookMatcherGroup[]>;
  disabled: boolean;
}

export interface PluginCommands {
  name: string;
  description: string;
  /** Body of the markdown command file, if any. */
  content?: string;
}

export interface PluginAgents {
  name: string;
  description?: string;
  content: string;
}

export interface PluginSkills {
  name: string;
  description: string;
  path: string;
}

export interface PluginMcpServers {
  servers: Record<string, unknown>;
}

export function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    logger.warn(`Failed to read ${filePath}`, error);
    return null;
  }
}

export function expandListField(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  return [];
}

export function resolvePluginPath(plugin: LoadedPlugin, entry: string): string {
  return path.isAbsolute(entry)
    ? entry
    : path.join(plugin.path, entry.replace(/^\.\//, ""));
}

/**
 * Substitute the plugin variables inside a nested config value, one string at a
 * time - see `substitutePluginVariablesDeep`.
 */
export function substituteVariablesDeep(
  value: Record<string, unknown>,
  plugin: LoadedPlugin,
): Record<string, unknown> {
  return substitutePluginVariablesDeep(value, plugin);
}

/**
 * Resolve the plugin variables a hook handler may reference. The runner has
 * no plugin binding, so the root and data directory have to be baked into the
 * strings here, the same way commands and agents are substituted at load time.
 */
function substituteHandlerVariables(
  handler: HookHandler,
  plugin: LoadedPlugin,
): HookHandler {
  switch (handler?.type) {
    case "command":
      return {
        ...handler,
        command: substitutePluginVariables(handler.command, plugin),
      };
    case "prompt":
    case "agent":
      return {
        ...handler,
        prompt: substitutePluginVariables(handler.prompt, plugin),
      };
    case "http":
      return {
        ...handler,
        url: substitutePluginVariables(handler.url, plugin),
      };
    default:
      return handler;
  }
}

/**
 * Load hooks contributed by plugins. Both hooks/hooks.json and the manifest's
 * inline or file-referenced hooks are merged, matching Claude Code.
 */
export function loadPluginHooks(plugins: LoadedPlugin[]): PluginHooks {
  const config: Record<string, HookMatcherGroup[]> = {};
  let disabled = false;

  const merge = (
    incoming: Record<string, HookMatcherGroup[]>,
    plugin: LoadedPlugin,
  ) => {
    for (const [event, groups] of Object.entries(incoming)) {
      if (!Array.isArray(groups)) continue;
      const resolved = groups.map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).map((handler) =>
          substituteHandlerVariables(handler, plugin),
        ),
      }));
      config[event] = [...(config[event] ?? []), ...resolved];
    }
  };

  for (const plugin of plugins) {
    const hooksFile = path.join(plugin.path, "hooks", "hooks.json");
    const fileConfig = readJson<HookSettingsFile>(hooksFile);
    if (fileConfig?.hooks) {
      merge(fileConfig.hooks as Record<string, HookMatcherGroup[]>, plugin);
    }
    if (fileConfig?.disableAllHooks) {
      disabled = true;
    }

    const manifestHooks = plugin.manifest.hooks;
    if (typeof manifestHooks === "string") {
      const resolved = path.join(plugin.path, manifestHooks);
      const fromFile = readJson<HookSettingsFile>(resolved);
      if (fromFile?.hooks) {
        merge(fromFile.hooks as Record<string, HookMatcherGroup[]>, plugin);
      }
    } else if (manifestHooks && typeof manifestHooks === "object") {
      const asSettings = manifestHooks as HookSettingsFile;
      if (asSettings.hooks) {
        merge(asSettings.hooks as Record<string, HookMatcherGroup[]>, plugin);
      }
    }
  }

  return { config, disabled };
}

/**
 * Directory order is the filesystem's, not the manifest's, and both lists below
 * reach the model: an agent listing and a slash-command palette whose order
 * changes between runs is a prefix that cannot stay cached, and a first-match
 * lookup that can pick a different file each boot. Sorting makes both a pure
 * function of the installed files.
 */
function sortedMarkdownFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort();
}

export function loadPluginCommands(plugins: LoadedPlugin[]): PluginCommands[] {
  const commands: PluginCommands[] = [];
  const taken = new Set<string>();

  for (const plugin of plugins) {
    const declared = expandListField(plugin.manifest.commands);
    const dirs =
      declared.length > 0 ? declared : [path.join(plugin.path, "commands")];

    for (const entry of dirs) {
      const dir = path.isAbsolute(entry)
        ? entry
        : path.join(plugin.path, entry.replace(/^\.\//, ""));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

      for (const file of sortedMarkdownFiles(dir)) {
        const fullPath = path.join(dir, file);
        const name = `${plugin.name}:${path.basename(file, ".md")}`;
        if (taken.has(name)) {
          // A manifest may list the same directory twice, or list two that hold
          // the same file name. Dropping the copy silently would leave the model
          // with a command whose body depends on scan order.
          logger.warn(
            `Duplicate plugin command ${name} at ${fullPath}: keeping the first`,
          );
          continue;
        }
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          taken.add(name);
          commands.push({
            name,
            description: plugin.description ?? `Plugin ${plugin.name}`,
            content: substitutePluginVariables(content, plugin),
          });
        } catch (error) {
          logger.warn(`Failed to read plugin command ${fullPath}`, error);
        }
      }
    }
  }

  return commands;
}

export function loadPluginAgents(plugins: LoadedPlugin[]): PluginAgents[] {
  const agents: PluginAgents[] = [];
  const taken = new Set<string>();

  for (const plugin of plugins) {
    const declared = expandListField(plugin.manifest.agents);
    const dirs =
      declared.length > 0 ? declared : [path.join(plugin.path, "agents")];

    for (const entry of dirs) {
      const dir = path.isAbsolute(entry)
        ? entry
        : path.join(plugin.path, entry.replace(/^\.\//, ""));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

      for (const file of sortedMarkdownFiles(dir)) {
        const fullPath = path.join(dir, file);
        // The agent a model asks for is found by this name, and two plugins can
        // both ship agents/review.md. Bare names made the winner depend on install
        // order, so the plugin is part of the name, exactly as it is for commands.
        const name = `${plugin.name}:${path.basename(file, ".md")}`;
        if (taken.has(name)) {
          logger.warn(
            `Duplicate plugin agent ${name} at ${fullPath}: keeping the first`,
          );
          continue;
        }
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          taken.add(name);
          agents.push({
            name,
            description: plugin.description,
            content: substitutePluginVariables(content, plugin),
          });
        } catch (error) {
          logger.warn(`Failed to read plugin agent ${fullPath}`, error);
        }
      }
    }
  }

  return agents;
}

/**
 * Skill files inside a plugin's skills directory. Claude Code nests each skill
 * in its own subdirectory, but a manifest may also point straight at a
 * directory holding a single SKILL.md, so both shapes are accepted.
 */
function findSkillFiles(dir: string): string[] {
  const direct = path.join(dir, "SKILL.md");
  const found: string[] = [];

  if (fs.existsSync(direct)) {
    found.push(direct);
  }

  for (const entry of safeReaddir(dir)) {
    const nested = path.join(dir, entry, "SKILL.md");
    if (fs.existsSync(nested)) {
      found.push(nested);
    }
  }

  return found;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => fs.statSync(path.join(dir, entry)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

export function loadPluginSkills(plugins: LoadedPlugin[]): PluginSkills[] {
  const skills: PluginSkills[] = [];

  for (const plugin of plugins) {
    const declared = expandListField(plugin.manifest.skills);
    const dirs =
      declared.length > 0 ? declared : [path.join(plugin.path, "skills")];

    for (const entry of dirs) {
      const dir = path.isAbsolute(entry)
        ? entry
        : path.join(plugin.path, entry.replace(/^\.\//, ""));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

      for (const fullPath of findSkillFiles(dir)) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const nameMatch = /^name:\s*(.+)$/m.exec(content);
          const descMatch = /^description:\s*(.+)$/m.exec(content);
          skills.push({
            name: nameMatch?.[1]?.trim() ?? path.basename(dir),
            description: descMatch?.[1]?.trim() ?? "",
            path: fullPath,
          });
        } catch (error) {
          logger.warn(`Failed to read plugin skill ${fullPath}`, error);
        }
      }
    }
  }

  return skills;
}

export function loadPluginMcpServers(
  plugins: LoadedPlugin[],
): Record<string, unknown> {
  const servers: Record<string, unknown> = {};

  for (const plugin of plugins) {
    const mcp = plugin.manifest.mcpServers;
    if (!mcp) continue;

    let resolved: Record<string, unknown> | null = null;
    if (typeof mcp === "string") {
      resolved = readJson<Record<string, unknown>>(
        path.join(plugin.path, mcp.replace(/^\.\//, "")),
      );
    } else {
      resolved = mcp;
    }

    if (!resolved) continue;

    for (const [name, serverConfig] of Object.entries(resolved)) {
      if (typeof serverConfig !== "object" || serverConfig === null) continue;
      servers[`${plugin.name}-${name}`] = substitutePluginVariablesDeep(
        serverConfig,
        plugin,
      );
    }
  }

  return servers;
}
