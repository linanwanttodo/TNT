import path from "node:path";

import type { IHooksService } from "@zcode/services";
import type { Hook, HookEvent } from "@zcode/shared";

import { globalDir } from "../config/globalDir.js";
import {
  readSettingsFile,
  writeSettingsValue,
} from "../config/settingsFiles.js";
import type {
  CommandHookHandler,
  HookMatcherGroup,
  HooksConfig,
} from "../hooks/types.js";
import { logger } from "../utils/logger.js";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";

const ZCODE_EVENTS = new Set<string>([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
]);

function userSettingsFile(): string {
  return path.join(globalDir(), "settings.json");
}

function projectSettingsFile(workspacePath: string): string {
  return path.join(workspacePath, ".tnt", "settings.json");
}

function readHooksConfig(filePath: string): {
  hooks: HooksConfig;
  disabled: boolean;
} {
  const settings = readSettingsFile(filePath);
  return {
    hooks: (settings?.hooks as HooksConfig | undefined) ?? {},
    disabled: settings?.disableAllHooks === true,
  };
}

function isCommandHandler(handler: unknown): handler is CommandHookHandler {
  return (
    !!handler &&
    typeof handler === "object" &&
    (handler as { type?: unknown }).type === "command"
  );
}

function hooksFromFile(
  filePath: string,
  scope: "user" | "project",
  projectPath?: string,
): Hook[] {
  const { hooks, disabled } = readHooksConfig(filePath);
  const result: Hook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!ZCODE_EVENTS.has(event) || !Array.isArray(groups)) {
      continue;
    }
    groups.forEach((group: HookMatcherGroup, groupIndex: number) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
      handlers.forEach((handler, handlerIndex) => {
        if (isCommandHandler(handler)) {
          result.push({
            id: `${filePath}:${event}:${groupIndex}:${handlerIndex}`,
            event: event as HookEvent,
            ...(group.matcher && group.matcher !== "*"
              ? { matcher: group.matcher }
              : {}),
            type: "command",
            command: handler.command,
            ...(typeof handler.async === "boolean"
              ? { async: handler.async }
              : {}),
            ...(handler.statusMessage
              ? { statusMessage: handler.statusMessage }
              : {}),
            ...(typeof handler.timeout === "number"
              ? { timeout: handler.timeout }
              : {}),
            enabled: handler.enabled !== false && !disabled,
            editable: true,
            location: {
              source: "zcode",
              scope,
              directoryPath: path.dirname(filePath),
              ...(scope === "project" && projectPath ? { projectPath } : {}),
            },
          });
        }
      });
    });
  }
  return result;
}

/**
 * Replaces the command handlers in one settings file while leaving every
 * non-command handler, every other key and the disabled flag alone: the
 * settings page only owns command hooks, and a save must not delete an http,
 * prompt or agent hook it never displayed.
 */
function writeCommandHooks(filePath: string, hooks: Hook[]): void {
  const existing = readSettingsFile(filePath) ?? {};
  const current = (existing.hooks as HooksConfig | undefined) ?? {};
  const preserved: HooksConfig = {};
  for (const [event, groups] of Object.entries(current)) {
    if (!Array.isArray(groups)) {
      continue;
    }
    const kept: HookMatcherGroup[] = [];
    for (const group of groups) {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
      const nonCommand = handlers.filter(
        (handler) => !isCommandHandler(handler),
      );
      if (nonCommand.length > 0) {
        kept.push({ ...group, hooks: nonCommand });
      }
    }
    if (kept.length > 0) {
      preserved[event as keyof HooksConfig] = kept;
    }
  }

  for (const hook of hooks) {
    const event = hook.event as keyof HooksConfig;
    const handler: CommandHookHandler = {
      type: "command",
      command: hook.command,
    };
    if (hook.async !== undefined) handler.async = hook.async;
    if (hook.statusMessage) handler.statusMessage = hook.statusMessage;
    if (typeof hook.timeout === "number") handler.timeout = hook.timeout;
    if (hook.enabled === false) handler.enabled = false;
    const groups = preserved[event] ?? [];
    const matchIndex = groups.findIndex(
      (group) => (group.matcher ?? "") === (hook.matcher ?? ""),
    );
    if (matchIndex >= 0) {
      groups[matchIndex] = {
        ...groups[matchIndex],
        hooks: [...groups[matchIndex].hooks, handler],
      };
    } else {
      groups.push({
        ...(hook.matcher ? { matcher: hook.matcher } : {}),
        hooks: [handler],
      });
    }
    preserved[event] = groups;
  }

  writeSettingsValue(filePath, "hooks", preserved);
}

export function createTntHooksService(): IHooksService {
  return {
    async loadHooks({ workspacePath, scope }) {
      const files: { file: string; scope: "user" | "project" }[] =
        scope === "user"
          ? [{ file: userSettingsFile(), scope: "user" }]
          : [
              { file: userSettingsFile(), scope: "user" },
              { file: projectSettingsFile(workspacePath), scope: "project" },
            ];
      const hooks = files.flatMap(({ file, scope: fileScope }) =>
        hooksFromFile(file, fileScope, workspacePath),
      );
      const disabled = files.some(({ file }) => readHooksConfig(file).disabled);
      return { hooks, hooksEnabled: !disabled };
    },

    async saveHooks({ workspacePath, hooks, scope }) {
      const userHooks = hooks.filter(
        (hook) => (hook.location?.scope ?? "user") !== "project",
      );
      const projectHooks = hooks.filter(
        (hook) => hook.location?.scope === "project",
      );
      writeCommandHooks(userSettingsFile(), userHooks);
      if (scope !== "user") {
        writeCommandHooks(projectSettingsFile(workspacePath), projectHooks);
      }
      logger.debug("webui hooks: saved", {
        user: userHooks.length,
        project: projectHooks.length,
      });
    },

    async grantWorkspaceHookTrust() {
      throw new Error(
        `${UNAVAILABLE}: hooks: workspace hook review is not part of this shell`,
      );
    },
  };
}
