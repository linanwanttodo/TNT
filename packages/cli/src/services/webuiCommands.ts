import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ICommandsService } from "@zcode/services";
import type {
  CommandConfig,
  CommandsListResult,
  PluginCommand,
  UserCommand,
} from "@zcode/shared";

import {
  loadLocalCommandFiles,
  localCommandRoots,
  type LocalCommandFile,
} from "../commands/localCommandFiles.js";
import { globalDir } from "../config/globalDir.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { setCommandEnabled } from "../utils/commandsState.js";
import { logger } from "../utils/logger.js";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";

function realWithin(target: string, root: string): boolean {
  try {
    const resolved = realpathSync(target);
    const resolvedRoot = realpathSync(root);
    return (
      resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
    );
  } catch {
    return false;
  }
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "command"
  );
}

function locationFor(
  file: LocalCommandFile,
  workspacePath?: string,
): UserCommand["location"] {
  if (file.scope === "user") {
    return {
      source: "zcode",
      scope: "user",
      directoryPath: path.dirname(file.filePath),
    };
  }
  return {
    source: "zcode",
    scope: "project",
    directoryPath: path.dirname(file.filePath),
    ...(workspacePath ? { projectPath: workspacePath } : {}),
  };
}

function toUserCommand(
  file: LocalCommandFile,
  workspacePath?: string,
): UserCommand {
  return {
    id: file.filePath,
    name: file.name,
    prompt: file.prompt,
    content: file.prompt,
    filePath: file.filePath,
    description: file.description,
    ...(file.argumentHint ? { argumentHint: file.argumentHint } : {}),
    source: "user",
    agentSource: "zcodeAgent",
    location: locationFor(file, workspacePath),
    enabled: file.enabled,
    scope: file.scope === "workspace" ? "project" : "global",
    ...(file.scope === "workspace" && workspacePath
      ? { projectPath: workspacePath }
      : {}),
  };
}

function pluginCommands(): PluginCommand[] {
  try {
    return loadAllPlugins().commands.map((command) => {
      const [pluginName = "", ...rest] = command.name.split(":");
      return {
        id: `plugin:${command.name}`,
        name: command.name,
        prompt: command.content ?? "",
        content: command.content ?? "",
        description: command.description,
        filePath: "",
        source: "plugin",
        enabled: true,
        pluginName,
        pluginMarketplace: rest.join(":") || pluginName,
        pluginEnabled: true,
        scope: "global",
      };
    });
  } catch (error) {
    logger.warn("webui commands: could not load plugin commands", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function writeCommand(
  config: CommandConfig,
  scope: "user" | "workspace",
  workspacePath: string | undefined,
  keepPath?: string,
): string {
  const name = config.name?.trim();
  if (!name) {
    throw new Error(`${UNAVAILABLE}: commands: a command needs a name`);
  }
  if (!config.prompt?.trim()) {
    throw new Error(`${UNAVAILABLE}: commands: a command needs a prompt`);
  }
  const root =
    scope === "workspace" && workspacePath
      ? path.join(workspacePath, ".tnt", "commands")
      : path.join(globalDir(), "commands");
  const directory =
    keepPath &&
    localCommandRoots().some((candidate) => {
      return realWithin(path.dirname(keepPath), candidate.directory);
    })
      ? path.dirname(keepPath)
      : root;
  const file = path.join(directory, `${slug(name)}.md`);
  const frontmatter = [
    `name: ${JSON.stringify(name)}`,
    ...(config.description
      ? [`description: ${JSON.stringify(config.description)}`]
      : []),
    ...(config.argumentHint
      ? [`argument-hint: ${JSON.stringify(config.argumentHint)}`]
      : []),
  ];
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    `---\n${frontmatter.join("\n")}\n---\n\n${config.prompt.trim()}\n`,
    { mode: 0o600 },
  );
  if (keepPath && path.resolve(keepPath) !== path.resolve(file)) {
    rmSync(keepPath, { force: true });
  }
  return file;
}

function isManagedCommandPath(filePath: string): boolean {
  const directory = path.dirname(path.resolve(filePath));
  const grandParent = path.basename(path.dirname(directory));
  return (
    directory === path.join(realpathOr(globalDir()), "commands") ||
    (path.basename(directory) === "commands" &&
      (grandParent === ".tnt" || grandParent === ".claude"))
  );
}

function commandFileForDelete(filePath: string): string {
  if (!isManagedCommandPath(filePath) || path.extname(filePath) !== ".md") {
    throw new Error(
      `${UNAVAILABLE}: commands: ${filePath} is not in a managed command directory`,
    );
  }
  return realpathSync(filePath);
}

function realpathOr(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

export function createTntCommandsService(): ICommandsService {
  return {
    async list({ workspacePath }): Promise<CommandsListResult> {
      const files = loadLocalCommandFiles(workspacePath);
      const userCommands = files.map((file) =>
        toUserCommand(file, workspacePath),
      );
      const plugin = pluginCommands();
      return {
        commands: [...userCommands, ...plugin],
        userCommands,
        pluginCommands: plugin,
        capability: { userScopeAvailable: true },
      };
    },

    async writeCommandFile({ config, storageLevel, workspacePath }) {
      const file = writeCommand(
        config,
        storageLevel === "project" ? "workspace" : "user",
        workspacePath,
      );
      const command = loadLocalCommandFiles(workspacePath).find(
        (candidate) => candidate.name === config.name?.trim(),
      );
      if (!command) {
        throw new Error(
          `${UNAVAILABLE}: commands: the command was written to ${file} but could not be read back`,
        );
      }
      return { command: toUserCommand(command, workspacePath) };
    },

    async updateCommandFile({
      config,
      oldFilePath,
      storageLevel,
      workspacePath,
    }) {
      if (!oldFilePath) {
        throw new Error(
          `${UNAVAILABLE}: commands: an update needs the command's file path`,
        );
      }
      commandFileForDelete(oldFilePath);
      writeCommand(
        config,
        storageLevel === "project" ? "workspace" : "user",
        workspacePath,
        oldFilePath,
      );
      const command = loadLocalCommandFiles(workspacePath).find(
        (candidate) => candidate.name === config.name?.trim(),
      );
      if (!command) {
        throw new Error(
          `${UNAVAILABLE}: commands: the command was written but could not be read back`,
        );
      }
      return { command: toUserCommand(command, workspacePath) };
    },

    async deleteCommandFile({ filePath }) {
      rmSync(commandFileForDelete(filePath), { force: true });
    },

    async setCommandEnabled({ commandId, filePath, enabled }) {
      const target = filePath || commandId;
      if (!isManagedCommandPath(target)) {
        throw new Error(
          `${UNAVAILABLE}: commands: ${target} is outside this machine's command roots`,
        );
      }
      setCommandEnabled(target, enabled);
    },

    async getPrimaryUserCommandsDirectory() {
      return { path: path.join(globalDir(), "commands") };
    },
  };
}
