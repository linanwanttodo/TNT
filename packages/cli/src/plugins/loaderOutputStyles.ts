import * as fs from "fs";
import * as path from "path";

import { parseMarkdownRule } from "@tnt/config-yaml";

import { logger } from "../utils/logger.js";

import {
  expandListField,
  readJson,
  resolvePluginPath,
  substituteVariablesDeep,
} from "./loaderContributions.js";
import type { LoadedPlugin } from "./manifest.js";
import { substitutePluginVariables } from "./manifest.js";

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

export function loadPluginOutputStyles(
  plugins: LoadedPlugin[],
): PluginOutputStyle[] {
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

export function loadPluginLspServers(
  plugins: LoadedPlugin[],
): PluginLspServer[] {
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
