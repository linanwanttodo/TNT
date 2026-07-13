import fs from "node:fs";
import path from "node:path";

import { parseMarkdownRule } from "@tnt/config-yaml";
import { stringify as stringifyYaml } from "yaml";

import { globalDir } from "../config/globalDir.js";
import { logger } from "../utils/logger.js";

import { isSubagentEnabled, subagentStateKey } from "./agentState.js";

/**
 * Subagents declared as markdown files, the same shape this CLI already reads
 * for review agents: YAML frontmatter plus the system prompt as the body.
 *
 * Roots, highest priority first: `.tnt/agents` in the workspace, the
 * Claude-compatible `.claude/agents`, and the machine-wide `~/.tnt/agents`.
 * A name in an earlier root wins, so a project can override a user agent.
 * The web settings page writes these files, and dispatch reads them back -
 * creating an agent in the browser makes it delegatable in the TUI.
 */
export interface MarkdownAgent {
  name: string;
  description: string;
  systemMessage: string;
  path: string;
  scope: "workspace" | "user";
  color?: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  background?: boolean;
  skills?: string[];
}

export interface MarkdownAgentRoot {
  directory: string;
  scope: "workspace" | "user";
}

export function markdownAgentRoots(
  cwd: string = process.cwd(),
  homeDir?: string,
): MarkdownAgentRoot[] {
  return [
    { directory: path.join(cwd, ".tnt", "agents"), scope: "workspace" },
    { directory: path.join(cwd, ".claude", "agents"), scope: "workspace" },
    { directory: path.join(globalDir(homeDir), "agents"), scope: "user" },
  ];
}

/** The root a new agent of this scope is written to. */
export function markdownAgentRoot(
  scope: "workspace" | "user",
  cwd: string = process.cwd(),
  homeDir?: string,
): MarkdownAgentRoot {
  return (
    markdownAgentRoots(cwd, homeDir).find((root) => root.scope === scope) ?? {
      directory: path.join(cwd, ".tnt", "agents"),
      scope,
    }
  );
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

function parseAgentFile(
  filePath: string,
  scope: "workspace" | "user",
): MarkdownAgent | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, markdown } = parseMarkdownRule(raw) as {
      frontmatter?: Record<string, unknown>;
      markdown?: string;
    };
    const front = frontmatter ?? {};
    const name =
      typeof front.name === "string" && front.name.trim()
        ? front.name.trim()
        : path.basename(filePath, path.extname(filePath));
    const body = (markdown ?? "").trim();
    if (!name || !body) {
      return null;
    }
    return {
      name,
      description:
        typeof front.description === "string" ? front.description.trim() : "",
      systemMessage: body,
      path: filePath,
      scope,
      ...(typeof front.color === "string" ? { color: front.color } : {}),
      ...(typeof front.model === "string" && front.model.trim()
        ? { model: front.model.trim() }
        : {}),
      ...(stringList(front.tools) ? { tools: stringList(front.tools) } : {}),
      ...(stringList(front.disallowedTools)
        ? { disallowedTools: stringList(front.disallowedTools) }
        : {}),
      ...(typeof front.permissionMode === "string"
        ? { permissionMode: front.permissionMode }
        : {}),
      ...(typeof front.maxTurns === "number"
        ? { maxTurns: front.maxTurns }
        : {}),
      ...(typeof front.background === "boolean"
        ? { background: front.background }
        : {}),
      ...(stringList(front.skills) ? { skills: stringList(front.skills) } : {}),
    };
  } catch (error) {
    logger.debug("Could not read a markdown agent", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * All markdown agents, deduplicated by name with the earlier root winning.
 * Disabled agents are still returned; callers that dispatch check the state.
 */
export function loadMarkdownAgents(
  cwd: string = process.cwd(),
  homeDir?: string,
): MarkdownAgent[] {
  const byName = new Map<string, MarkdownAgent>();
  for (const root of markdownAgentRoots(cwd, homeDir)) {
    let files: string[];
    try {
      files = fs
        .readdirSync(root.directory)
        .filter((file) => file.endsWith(".md"))
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const agent = parseAgentFile(path.join(root.directory, file), root.scope);
      if (!agent) {
        continue;
      }
      const key = agent.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, agent);
      }
    }
  }
  return [...byName.values()];
}

export function findMarkdownAgent(
  name: string,
  cwd: string = process.cwd(),
  homeDir?: string,
): MarkdownAgent | undefined {
  const key = name.trim().toLowerCase();
  return loadMarkdownAgents(cwd, homeDir).find(
    (agent) => agent.name.toLowerCase() === key,
  );
}

export function markdownAgentIsEnabled(agent: MarkdownAgent): boolean {
  return isSubagentEnabled(
    subagentStateKey("markdown", agent.name, agent.scope),
  );
}

export function slugifyAgentName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

/**
 * The file for a new agent. `keepPath` is the agent being updated, so a rename
 * moves the same document rather than leaving the old name behind.
 */
export function agentFilePath(
  agent: Pick<MarkdownAgent, "name" | "scope">,
  keepPath?: string,
): string {
  if (
    keepPath &&
    path.basename(keepPath) === `${slugifyAgentName(agent.name)}.md`
  ) {
    return keepPath;
  }
  const root = markdownAgentRoot(agent.scope);
  return path.join(root.directory, `${slugifyAgentName(agent.name)}.md`);
}

export interface AgentMarkdownInput {
  name: string;
  description: string;
  systemPrompt: string;
  color?: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  background?: boolean;
  skills?: string[];
}

export function serializeAgentMarkdown(agent: AgentMarkdownInput): string {
  const frontmatter: Record<string, unknown> = { name: agent.name };
  if (agent.description) {
    frontmatter.description = agent.description;
  }
  if (agent.color) {
    frontmatter.color = agent.color;
  }
  if (agent.model) {
    frontmatter.model = agent.model;
  }
  if (agent.tools && agent.tools.length > 0) {
    frontmatter.tools = agent.tools;
  }
  if (agent.disallowedTools && agent.disallowedTools.length > 0) {
    frontmatter.disallowedTools = agent.disallowedTools;
  }
  if (agent.permissionMode) {
    frontmatter.permissionMode = agent.permissionMode;
  }
  if (typeof agent.maxTurns === "number") {
    frontmatter.maxTurns = agent.maxTurns;
  }
  if (typeof agent.background === "boolean") {
    frontmatter.background = agent.background;
  }
  if (agent.skills && agent.skills.length > 0) {
    frontmatter.skills = agent.skills;
  }
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n\n${agent.systemPrompt.trim()}\n`;
}
