import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import {
  getSessionActiveTeam,
  setSessionActiveTeam,
} from "../../../session/index.js";
import {
  getTeam,
  invalidateTeamCache,
  loadTeams,
} from "../../../team/loader.js";
import type { SlashCommandResult } from "../types.js";

/**
 * Lists, activates or deactivates a team roster, or scaffolds a new one under
 * `.tnt/teams/`. Activation is in-memory session state (see
 * getSessionActiveTeam): it widens the dispatch chain with the roster's
 * members and, in a later turn, injects the lead's prompt. Nothing here
 * touches the cached prompt prefix.
 */
export function handleTeamCommand(args: string[] = []): SlashCommandResult {
  const [first, ...rest] = args;
  const cwd = process.cwd();

  if (first === "off") {
    setSessionActiveTeam(undefined);
    return { output: t("team.off") };
  }

  if (first === "create") {
    return createTeamRoster(rest, cwd);
  }

  if (!first) {
    return listTeams(cwd);
  }

  return activateTeam(first, cwd);
}

function listTeams(cwd: string): SlashCommandResult {
  const active = getSessionActiveTeam();
  const teams = loadTeams(cwd);
  const lines = [active ? t("team.current", { name: active }) : t("team.none")];
  if (teams.length === 0) {
    lines.push(t("team.noneAvailable"));
  } else {
    lines.push("", t("team.available"));
    for (const team of teams) {
      const memberCount = team.members.length;
      lines.push(
        `  ${chalk.cyan(team.name)} - ${t("team.memberCount", {
          count: memberCount,
        })} (${team.lead.name})`,
      );
    }
  }
  lines.push("", chalk.dim(t("team.usage")));
  return { output: lines.join("\n") };
}

function activateTeam(name: string, cwd: string): SlashCommandResult {
  const team = getTeam(name, cwd);
  if (!team) {
    const available = loadTeams(cwd)
      .map((team) => team.name)
      .join(", ");
    return {
      output: available
        ? t("team.unknown", { name, available })
        : t("team.noTeams", { name }),
    };
  }

  setSessionActiveTeam(team.name);
  return { output: t("team.set", { name: team.name, lead: team.lead.name }) };
}

const ROSTER_TEMPLATE = `name: lead
description: The lead of this team
team: {name}
lead: true
deniedTools: AskQuestion, Exit

You lead this team. Replace this paragraph with the persona prompt:
how the role breaks down work, what evidence it demands, and the shape
of its final report.
`;

function createTeamRoster(rest: string[], cwd: string): SlashCommandResult {
  const name = rest.filter((arg) => !arg.startsWith("--"))[0] ?? "";
  const from = rest.includes("--from")
    ? rest[rest.indexOf("--from") + 1]
    : undefined;

  if (!name || !/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    return { output: t("team.createUsage") };
  }

  const teamDir = path.join(cwd, ".tnt", "teams", name);
  const leadPath = path.join(teamDir, "lead.md");
  if (fs.existsSync(leadPath)) {
    return { output: t("team.createExists", { path: leadPath }) };
  }

  try {
    fs.mkdirSync(teamDir, { recursive: true });
    const body = from
      ? fs.readFileSync(from, "utf-8")
      : ROSTER_TEMPLATE.replace("{name}", name);
    fs.writeFileSync(leadPath, body);
  } catch (error) {
    return {
      output: t("team.createFailed", {
        path: leadPath,
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  invalidateTeamCache();
  return {
    output: t("team.created", {
      name,
      path: path.relative(cwd, leadPath),
    }),
  };
}
