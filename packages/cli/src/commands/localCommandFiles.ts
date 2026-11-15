import fs from "node:fs";
import path from "node:path";

import { parseMarkdownRule } from "@tnt/config-yaml";

import { globalDir } from "../config/globalDir.js";
import { isCommandEnabled } from "../utils/commandsState.js";
import { logger } from "../utils/logger.js";
/**
 * Prompt commands stored as markdown files: `<cwd>/.tnt/commands`,
 * the Claude-compatible `<cwd>/.claude/commands`, and `~/.tnt/commands`.
 * The body is the prompt, frontmatter may carry name/description/
 * argument-hint, and the file name is the command name when frontmatter
 * does not override it.
 */
export interface LocalCommandFile {
  name: string;
  description: string;
  prompt: string;
  filePath: string;
  argumentHint?: string;
  scope: "workspace" | "user";
  enabled: boolean;
}

export function localCommandRoots(
  cwd: string = process.cwd(),
): { directory: string; scope: "workspace" | "user" }[] {
  return [
    { directory: path.join(cwd, ".tnt", "commands"), scope: "workspace" },
    { directory: path.join(cwd, ".claude", "commands"), scope: "workspace" },
    { directory: path.join(globalDir(), "commands"), scope: "user" },
  ];
}

function readCommandFile(
  filePath: string,
  scope: "workspace" | "user",
): LocalCommandFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, markdown } = parseMarkdownRule(raw) as {
      frontmatter?: Record<string, unknown>;
      markdown?: string;
    };
    const front = frontmatter ?? {};
    const fallbackName = path.basename(filePath, path.extname(filePath));
    const name =
      typeof front.name === "string" && front.name.trim()
        ? front.name.trim()
        : fallbackName;
    const prompt = (markdown ?? "").trim();
    if (!name || !prompt) {
      return null;
    }
    return {
      name,
      description:
        typeof front.description === "string" ? front.description : "",
      prompt,
      filePath,
      ...(typeof front["argument-hint"] === "string"
        ? { argumentHint: front["argument-hint"] }
        : {}),
      scope,
      enabled: isCommandEnabled(filePath),
    };
  } catch (error) {
    logger.debug("Could not read a local command file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** All local command files, earlier roots winning on a duplicate name. */
export function loadLocalCommandFiles(
  cwd: string = process.cwd(),
): LocalCommandFile[] {
  const byName = new Map<string, LocalCommandFile>();
  for (const root of localCommandRoots(cwd)) {
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
      const command = readCommandFile(
        path.join(root.directory, file),
        root.scope,
      );
      const key = command?.name.toLowerCase();
      if (command && key && !byName.has(key)) {
        byName.set(key, command);
      }
    }
  }
  return [...byName.values()];
}

export function findLocalCommand(
  name: string,
  cwd: string = process.cwd(),
): LocalCommandFile | undefined {
  const key = name.trim().toLowerCase();
  return loadLocalCommandFiles(cwd).find(
    (command) => command.name.toLowerCase() === key,
  );
}

export function buildLocalCommandInput(
  command: LocalCommandFile,
  args: string[],
): string {
  const argument = args.join(" ").trim();
  return argument ? `${command.prompt}\n\n${argument}` : command.prompt;
}
