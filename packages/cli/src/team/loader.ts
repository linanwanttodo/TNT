import * as fs from "fs";
import * as path from "path";

import { parseMarkdownRule } from "@tnt/config-yaml";

import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

import { DEFAULT_TEAMS } from "./defaultTeams.js";
import { SubagentRestriction } from "./restrictions.js";

export interface TeamMember {
  name: string;
  description: string;
  team: string;
  lead: boolean;
  restriction?: SubagentRestriction;
  deniedTools?: string[];
  /**
   * References a built-in agent instead of carrying a prompt. The system
   * message and restriction resolve at dispatch time from the built-in
   * registry, so a roster can reuse the shipped personas without copying
   * their text. Ignored when absent.
   */
  builtInRef?: string;
  systemMessage: string;
  source: "project" | "global" | "default";
}

export interface TeamDefinition {
  name: string;
  members: TeamMember[];
  lead: TeamMember;
}

/**
 * Team rosters are markdown files under `teams/<team-name>/<member>.md` in the
 * project's `.tnt` directory and the user's global directory. The project copy
 * of a member wins over the global one; both win over the defaults compiled
 * into the CLI.
 */
function teamSearchRoots(cwd: string): {
  dir: string;
  source: TeamMember["source"];
}[] {
  return [
    { dir: path.join(cwd, ".tnt", "teams"), source: "project" },
    { dir: path.join(env.continueHome, "teams"), source: "global" },
  ];
}

/**
 * The result is memoized against a fingerprint of the roster roots, because
 * the loader sits on the per-round critical path (the dispatch chain and the
 * /team listing). Adding or removing a roster file changes the fingerprint and
 * triggers a reload; invalidateTeamCache covers anything else that mutates the
 * files in place.
 */
let teamCache: { fingerprint: string; result: TeamDefinition[] } | null = null;

function fingerprintRoots(roots: { dir: string }[]): string {
  const parts: string[] = [];
  for (const { dir } of roots) {
    try {
      const stat = fs.statSync(dir);
      parts.push(`${dir}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${dir}:missing`);
    }
  }
  return parts.join("|");
}

const RESTRICTIONS: readonly SubagentRestriction[] = ["readonly", "no-writes"];

function parseMember(
  filePath: string,
  content: string,
  team: string,
  source: TeamMember["source"],
): TeamMember | undefined {
  const { frontmatter: ruleFrontmatter, markdown } = parseMarkdownRule(content);
  // Team rosters declare fields the rules schema does not know about; the
  // frontmatter is YAML either way, so it is read as an untyped record.
  const frontmatter = ruleFrontmatter as Record<string, unknown>;
  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  if (!name) {
    logger.warn(`Team member ${filePath} has no name: skipping`);
    return undefined;
  }

  const restrictionRaw = frontmatter.restriction;
  const restriction =
    typeof restrictionRaw === "string" &&
    (RESTRICTIONS as readonly string[]).includes(restrictionRaw)
      ? (restrictionRaw as SubagentRestriction)
      : undefined;
  if (restrictionRaw !== undefined && !restriction) {
    logger.warn(
      `Team member ${filePath} declares unknown restriction "${String(restrictionRaw)}": ignoring it`,
    );
  }

  const deniedToolsRaw = frontmatter.deniedTools;
  const deniedTools = Array.isArray(deniedToolsRaw)
    ? deniedToolsRaw.map(String)
    : typeof deniedToolsRaw === "string"
      ? deniedToolsRaw
          .split(",")
          .map((tool) => tool.trim())
          .filter(Boolean)
      : undefined;

  return {
    name,
    description:
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : (markdown.trim().split("\n")[0] ?? ""),
    team,
    lead: frontmatter.lead === true,
    restriction,
    deniedTools,
    systemMessage: markdown,
    source,
  };
}

function loadMembersFromDir(
  dir: string,
  teamName: string,
  source: TeamMember["source"],
  taken: Map<string, TeamMember>,
): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return;
  }

  for (const file of sortedDirEntries(dir)) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const fullPath = path.join(dir, file);
    if (!fs.statSync(fullPath).isFile()) {
      continue;
    }
    const memberName = path.basename(file, ".md");
    if (taken.has(memberName)) {
      logger.warn(
        `Duplicate team member ${memberName} at ${fullPath}: keeping the first`,
      );
      continue;
    }
    try {
      const member = parseMember(
        fullPath,
        fs.readFileSync(fullPath, "utf-8"),
        teamName,
        source,
      );
      if (member) {
        taken.set(memberName, member);
      }
    } catch (error) {
      logger.warn(`Failed to read team member ${fullPath}`, error);
    }
  }
}

function sortedDirEntries(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

/**
 * Load every team roster, default teams first and user rosters layered on top.
 * A team with no lead member is dropped with a warning rather than handed to
 * the dispatch chain, which expects exactly one.
 */
function loadAllTeams(cwd: string): TeamDefinition[] {
  const roots = teamSearchRoots(cwd);
  const byTeam = new Map<string, Map<string, TeamMember>>();

  const ensure = (teamName: string) => {
    let members = byTeam.get(teamName);
    if (!members) {
      members = new Map();
      byTeam.set(teamName, members);
    }
    return members;
  };

  for (const { dir, source } of roots) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }
    for (const teamName of sortedDirEntries(dir)) {
      const teamDir = path.join(dir, teamName);
      if (!fs.statSync(teamDir).isDirectory()) {
        continue;
      }
      loadMembersFromDir(teamDir, teamName, source, ensure(teamName));
    }
  }

  const teams: TeamDefinition[] = [];
  for (const [teamName, members] of byTeam) {
    const list = [...members.values()];
    const leads = list.filter((member) => member.lead);
    if (leads.length !== 1) {
      logger.warn(
        `Team ${teamName} has ${leads.length} lead members: skipping the team`,
      );
      continue;
    }
    teams.push({ name: teamName, members: list, lead: leads[0] });
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load the file-based rosters only, without the compiled-in defaults. This is
 * the unit the roster-file contract (layering, warnings, lead validation)
 * applies to; loadTeams layers the defaults on top.
 */
export function loadFileTeams(cwd: string): TeamDefinition[] {
  return loadAllTeams(cwd);
}

export function loadTeams(cwd: string): TeamDefinition[] {
  const roots = teamSearchRoots(cwd);
  const fingerprint = fingerprintRoots(roots);
  if (teamCache && teamCache.fingerprint === fingerprint) {
    return teamCache.result;
  }
  const result = [...loadAllTeams(cwd), ...DEFAULT_TEAMS];
  teamCache = { fingerprint, result };
  return result;
}

export function getTeam(
  teamName: string,
  cwd: string,
): TeamDefinition | undefined {
  return loadTeams(cwd).find((team) => team.name === teamName);
}

export function invalidateTeamCache(): void {
  teamCache = null;
}
