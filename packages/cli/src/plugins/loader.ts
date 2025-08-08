import * as fs from "fs";
import * as path from "path";

import { parseMarkdownRule } from "@tnt/config-yaml";

import type { HookMatcherGroup, HookSettingsFile } from "../hooks/types.js";
import { logger } from "../utils/logger.js";

import { getPluginSearchRoots } from "./directories.js";
import {
  discoverInstalledPlugins,
  type LoadedPlugin,
  substitutePluginVariables,
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

export interface PluginOutputStyle {
  /** Namespaced as "plugin:style", matching commands and agents. */
  name: string;
  plugin: string;
  description: string;
  /** Markdown body of the style file, sent as part of the system message. */
  prompt: string;
  /**
   * A style marked this way is applied as soon as the plugin is enabled,
   * without the user selecting it.
   */
  forceForPlugin?: boolean;
}

export interface PluginLspServer {
  /** Namespaced as "plugin-server" so two plugins cannot collide. */
  name: string;
  plugin: string;
  config: Record<string, unknown>;
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  hooks: PluginHooks;
  commands: PluginCommands[];
  agents: PluginAgents[];
  skills: PluginSkills[];
  mcpServers: Record<string, unknown>;
  outputStyles: PluginOutputStyle[];
  lspServers: PluginLspServer[];
}

/**
 * Marketplace names reserved by Claude Code. Registering a third-party
 * marketplace under one of these names is refused so plugin authors cannot
 * impersonate the official catalog.
 */
const RESERVED_MARKETPLACE_NAMES = new Set([
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "life-sciences",
  "knowledge-work-plugins",
]);

const RESERVED_NAME_PATTERN =
  /(?:official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official|^(?:anthropic|claude)[^a-z0-9]*(marketplace|plugins|official))/i;

export function isBlockedMarketplaceName(name: string): boolean {
  if (RESERVED_MARKETPLACE_NAMES.has(name.toLowerCase())) {
    return false;
  }
  if (/[^ -~]/.test(name)) {
    return true;
  }
  return RESERVED_NAME_PATTERN.test(name);
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    logger.warn(`Failed to read ${filePath}`, error);
    return null;
  }
}

function expandListField(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  return [];
}

function resolvePluginPath(plugin: LoadedPlugin, entry: string): string {
  return path.isAbsolute(entry)
    ? entry
    : path.join(plugin.path, entry.replace(/^\.\//, ""));
}

/**
 * Substitute the plugin variables inside a nested config value. Falls back to
 * the original value when the round trip fails, so a config that cannot be
 * re-serialized still reaches the caller instead of disappearing.
 */
function substituteVariablesDeep(
  value: Record<string, unknown>,
  plugin: LoadedPlugin,
): Record<string, unknown> {
  try {
    return JSON.parse(
      substitutePluginVariables(JSON.stringify(value), plugin),
    ) as Record<string, unknown>;
  } catch {
    return value;
  }
}

/**
 * Load hooks contributed by plugins. Both hooks/hooks.json and the manifest's
 * inline or file-referenced hooks are merged, matching Claude Code.
 */
function loadPluginHooks(plugins: LoadedPlugin[]): PluginHooks {
  const config: Record<string, HookMatcherGroup[]> = {};
  let disabled = false;

  const merge = (incoming: Record<string, HookMatcherGroup[]>) => {
    for (const [event, groups] of Object.entries(incoming)) {
      if (!Array.isArray(groups)) continue;
      config[event] = [...(config[event] ?? []), ...groups];
    }
  };

  for (const plugin of plugins) {
    const hooksFile = path.join(plugin.path, "hooks", "hooks.json");
    const fileConfig = readJson<HookSettingsFile>(hooksFile);
    if (fileConfig?.hooks) {
      merge(fileConfig.hooks as Record<string, HookMatcherGroup[]>);
    }
    if (fileConfig?.disableAllHooks) {
      disabled = true;
    }

    const manifestHooks = plugin.manifest.hooks;
    if (typeof manifestHooks === "string") {
      const resolved = path.join(plugin.path, manifestHooks);
      const fromFile = readJson<HookSettingsFile>(resolved);
      if (fromFile?.hooks) {
        merge(fromFile.hooks as Record<string, HookMatcherGroup[]>);
      }
    } else if (manifestHooks && typeof manifestHooks === "object") {
      const asSettings = manifestHooks as HookSettingsFile;
      if (asSettings.hooks) {
        merge(asSettings.hooks as Record<string, HookMatcherGroup[]>);
      }
    }
  }

  return { config, disabled };
}

function loadPluginCommands(plugins: LoadedPlugin[]): PluginCommands[] {
  const commands: PluginCommands[] = [];

  for (const plugin of plugins) {
    const declared = expandListField(plugin.manifest.commands);
    const dirs =
      declared.length > 0 ? declared : [path.join(plugin.path, "commands")];

    for (const entry of dirs) {
      const dir = path.isAbsolute(entry)
        ? entry
        : path.join(plugin.path, entry.replace(/^\.\//, ""));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const fullPath = path.join(dir, file);
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          commands.push({
            name: `${plugin.name}:${path.basename(file, ".md")}`,
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

function loadPluginAgents(plugins: LoadedPlugin[]): PluginAgents[] {
  const agents: PluginAgents[] = [];

  for (const plugin of plugins) {
    const declared = expandListField(plugin.manifest.agents);
    const dirs =
      declared.length > 0 ? declared : [path.join(plugin.path, "agents")];

    for (const entry of dirs) {
      const dir = path.isAbsolute(entry)
        ? entry
        : path.join(plugin.path, entry.replace(/^\.\//, ""));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const fullPath = path.join(dir, file);
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          agents.push({
            name: path.basename(file, ".md"),
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
      .filter((entry) => fs.statSync(path.join(dir, entry)).isDirectory());
  } catch {
    return [];
  }
}

function loadPluginSkills(plugins: LoadedPlugin[]): PluginSkills[] {
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

function loadPluginMcpServers(
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
      const substituted = substitutePluginVariables(
        JSON.stringify(serverConfig),
        plugin,
      );
      try {
        servers[`${plugin.name}-${name}`] = JSON.parse(substituted);
      } catch {
        servers[`${plugin.name}-${name}`] = serverConfig;
      }
    }
  }

  return servers;
}

/**
 * Output style files. A plugin may ship a default output-styles directory and
 * any number of extra files or directories declared in its manifest; both are
 * read, matching Claude Code.
 */
const DEFAULT_OUTPUT_STYLE_DIR = "output-styles";
const MAX_OUTPUT_STYLE_DEPTH = 4;

function collectMarkdownFiles(dir: string, depth = 0): string[] {
  if (depth > MAX_OUTPUT_STYLE_DEPTH) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** A manifest entry may point at a single markdown file or at a directory. */
function resolveMarkdownTargets(target: string): string[] {
  try {
    if (fs.statSync(target).isDirectory()) {
      return collectMarkdownFiles(target);
    }
  } catch {
    return [];
  }
  return target.endsWith(".md") ? [target] : [];
}

function parseForceFlag(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function loadOutputStyleFile(
  filePath: string,
  plugin: LoadedPlugin,
): PluginOutputStyle | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, markdown } = parseMarkdownRule(content) as {
      frontmatter: Record<string, unknown>;
      markdown: string;
    };

    const declaredName = frontmatter.name;
    const baseName =
      typeof declaredName === "string" && declaredName.trim()
        ? declaredName.trim()
        : path.basename(filePath, ".md");

    const prompt = substitutePluginVariables(markdown.trim(), plugin);
    if (!prompt) return null;

    const declaredDescription = frontmatter.description;

    return {
      name: `${plugin.name}:${baseName}`,
      plugin: plugin.name,
      description:
        typeof declaredDescription === "string"
          ? declaredDescription
          : `Output style from ${plugin.name}`,
      prompt,
      forceForPlugin: parseForceFlag(frontmatter["force-for-plugin"]),
    };
  } catch (error) {
    logger.warn(`Failed to read plugin output style ${filePath}`, error);
    return null;
  }
}

function loadPluginOutputStyles(plugins: LoadedPlugin[]): PluginOutputStyle[] {
  const styles: PluginOutputStyle[] = [];
  const seen = new Set<string>();

  for (const plugin of plugins) {
    const declared = expandListField(plugin.manifest.outputStyles);
    const entries = [DEFAULT_OUTPUT_STYLE_DIR, ...declared];

    for (const entry of entries) {
      const target = resolvePluginPath(plugin, entry);

      for (const filePath of resolveMarkdownTargets(target)) {
        const style = loadOutputStyleFile(filePath, plugin);
        if (!style || seen.has(style.name)) continue;
        seen.add(style.name);
        styles.push(style);
      }
    }
  }

  return styles;
}

/**
 * A style that a plugin forces is used without the user picking it. When more
 * than one plugin forces a style the first one wins, which is deterministic
 * because discovery order is.
 */
export function selectForcedOutputStyle(
  styles: readonly PluginOutputStyle[],
): PluginOutputStyle | undefined {
  const forced = styles.filter((style) => style.forceForPlugin === true);
  if (forced.length > 1) {
    logger.warn(
      `Multiple plugins force an output style; using ${forced[0].name}`,
    );
  }
  return forced[0];
}

function loadPluginLspServers(plugins: LoadedPlugin[]): PluginLspServer[] {
  const servers: PluginLspServer[] = [];

  for (const plugin of plugins) {
    const declared = plugin.manifest.lspServers;
    if (!declared) continue;

    const entries = Array.isArray(declared) ? declared : [declared];

    for (const entry of entries) {
      const resolved =
        typeof entry === "string"
          ? readJson<Record<string, unknown>>(resolvePluginPath(plugin, entry))
          : entry;

      if (!resolved || typeof resolved !== "object") continue;

      for (const [name, config] of Object.entries(resolved)) {
        if (!config || typeof config !== "object") continue;
        servers.push({
          name: `${plugin.name}-${name}`,
          plugin: plugin.name,
          config: substituteVariablesDeep(
            config as Record<string, unknown>,
            plugin,
          ),
        });
      }
    }
  }

  return servers;
}

/**
 * Load every installed plugin and project it onto the subsystems TNT already
 * has. Failures are contained: a broken plugin is skipped and logged rather
 * than taking down startup.
 */
export function loadAllPlugins(): PluginLoadResult {
  const plugins = discoverInstalledPlugins(getPluginSearchRoots());

  return {
    plugins,
    hooks: loadPluginHooks(plugins),
    commands: loadPluginCommands(plugins),
    agents: loadPluginAgents(plugins),
    skills: loadPluginSkills(plugins),
    mcpServers: loadPluginMcpServers(plugins),
    outputStyles: loadPluginOutputStyles(plugins),
    lspServers: loadPluginLspServers(plugins),
  };
}
