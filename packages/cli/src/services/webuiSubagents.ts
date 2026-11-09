import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ISubagentsService } from "@zcode/services";
import type {
  AgentSummary,
  AgentsListResult,
  ModelSelection,
  SubAgentConfig,
} from "@zcode/shared";
import { parse as parseYaml } from "yaml";

import { globalDir } from "../config/globalDir.js";
import { CONFIG_PATH } from "../config/providerSetup.js";
import { loadAllPlugins } from "../plugins/loader.js";
import {
  getSubagentPreference,
  isSubagentEnabled,
  removeSubagentPreference,
  setSubagentEnabled,
  setSubagentModelOverride,
  subagentStateKey,
} from "../subagent/agentState.js";
import { BUILT_IN_AGENTS } from "../subagent/builtInAgents.js";
import {
  loadMarkdownAgents,
  markdownAgentIsEnabled,
  serializeAgentMarkdown,
} from "../subagent/markdownAgents.js";
import { logger } from "../utils/logger.js";

import type { ConfigServiceState } from "./types.js";

import { serviceContainer, SERVICE_NAMES } from "./index.js";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";

interface ConfigModelEntry {
  name?: string;
  provider?: string;
  model?: string;
  roles?: string[];
  chatOptions?: { baseSystemMessage?: string };
}

function activeConfigPath(): string {
  if (serviceContainer.has(SERVICE_NAMES.CONFIG)) {
    const state = serviceContainer.getSync<ConfigServiceState>(
      SERVICE_NAMES.CONFIG,
    );
    if (state.state === "ready" && state.value?.configPath) {
      return state.value.configPath;
    }
  }
  return CONFIG_PATH;
}

function configuredSubagents(): ConfigModelEntry[] {
  try {
    const document = parseYaml(readFileSync(activeConfigPath(), "utf-8")) as {
      models?: unknown;
    } | null;
    if (!Array.isArray(document?.models)) {
      return [];
    }
    return (document.models as ConfigModelEntry[]).filter(
      (model) =>
        typeof model?.name === "string" &&
        model.name.length > 0 &&
        model.roles?.includes("subagent") &&
        typeof model.chatOptions?.baseSystemMessage === "string" &&
        model.chatOptions.baseSystemMessage.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function modelSelectionFor(
  modelName: string | undefined,
  thoughtLevel?: string,
): ModelSelection | undefined {
  if (!modelName) {
    return undefined;
  }
  const providerId =
    configuredSubagents().find((model) => model.name === modelName)?.provider ??
    "openai";
  return {
    providerId,
    modelId: modelName,
    ...(thoughtLevel ? { options: { reasoningLevel: thoughtLevel } } : {}),
  };
}

function modelSelectionFrom(
  selection: ModelSelection | undefined,
): { model?: string; thoughtLevel?: string } | undefined {
  if (!selection) {
    return undefined;
  }
  return {
    model: selection.modelId,
    ...(selection.options?.reasoningLevel
      ? { thoughtLevel: selection.options.reasoningLevel }
      : {}),
  };
}

function markdownSummary(
  agent: ReturnType<typeof loadMarkdownAgents>[number],
): AgentSummary {
  const key = subagentStateKey("markdown", agent.name, agent.scope);
  const preference = getSubagentPreference(key);
  return {
    id: key,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemMessage,
    ...(agent.color ? { color: agent.color as AgentSummary["color"] } : {}),
    ...(preference.model
      ? {
          modelSelection: modelSelectionFor(
            preference.model,
            preference.thoughtLevel,
          ),
        }
      : {}),
    ...(agent.tools ? { tools: agent.tools } : {}),
    ...(agent.disallowedTools
      ? { disallowedTools: agent.disallowedTools }
      : {}),
    ...(agent.permissionMode
      ? {
          permissionMode:
            agent.permissionMode as AgentSummary["permissionMode"],
        }
      : {}),
    ...(typeof agent.maxTurns === "number" ? { maxTurns: agent.maxTurns } : {}),
    ...(typeof agent.background === "boolean"
      ? { background: agent.background }
      : {}),
    path: agent.path,
    scope: agent.scope,
    source: "user",
    enabled: markdownAgentIsEnabled(agent),
    readOnly: false,
    ...(agent.scope === "workspace"
      ? { projectPath: path.dirname(path.dirname(path.dirname(agent.path))) }
      : {}),
  };
}

function builtInSummary(agent: (typeof BUILT_IN_AGENTS)[number]): AgentSummary {
  const key = subagentStateKey("builtin", agent.name);
  const preference = getSubagentPreference(key);
  return {
    id: key,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemMessage,
    path: "",
    scope: "built-in",
    source: "built-in",
    enabled: isSubagentEnabled(key),
    readOnly: true,
    ...(agent.deniedTools ? { disallowedTools: [...agent.deniedTools] } : {}),
    ...(preference.model
      ? {
          modelSelection: modelSelectionFor(
            preference.model,
            preference.thoughtLevel,
          ),
        }
      : {}),
  };
}

function configuredSummary(model: ConfigModelEntry): AgentSummary {
  const name = model.name as string;
  return {
    id: `config:${name.toLowerCase()}`,
    name,
    description:
      model.chatOptions?.baseSystemMessage?.trim().split("\n")[0] ?? "",
    systemPrompt: model.chatOptions?.baseSystemMessage ?? "",
    path: "",
    scope: "user",
    source: "user",
    enabled: true,
    readOnly: true,
  };
}

function pluginSummaries(): AgentSummary[] {
  try {
    return loadAllPlugins().agents.map((agent) => {
      const pluginName = agent.name.split(":")[0] ?? "";
      const key = subagentStateKey("plugin", agent.name);
      const preference = getSubagentPreference(key);
      return {
        id: key,
        name: agent.name,
        description: agent.description ?? "",
        systemPrompt: agent.content,
        path: "",
        scope: "user",
        source: "plugin",
        enabled: isSubagentEnabled(key),
        readOnly: true,
        ...(pluginName ? { pluginId: pluginName, pluginName } : {}),
        ...(preference.model
          ? {
              modelSelection: modelSelectionFor(
                preference.model,
                preference.thoughtLevel,
              ),
            }
          : {}),
      } as AgentSummary;
    });
  } catch (error) {
    logger.warn("webui subagents: could not load plugin agents", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * The write roots are the two agent directories this CLI reads - a workspace's
 * `.tnt/agents` and the machine-wide one. A path outside them (a plugin's own
 * directory, an arbitrary file) is refused before anything is unlinked.
 */
function managedAgentRoot(workspacePath?: string): string {
  return workspacePath
    ? path.join(workspacePath, ".tnt", "agents")
    : path.join(globalDir(), "agents");
}

function assertManagedAgentPath(
  filePath: string,
  workspacePath?: string,
): string {
  let resolved: string;
  try {
    resolved = realpathSync(filePath);
  } catch {
    throw new Error(
      `${UNAVAILABLE}: subagents: agent file does not exist: ${filePath}`,
    );
  }
  const parent = path.dirname(resolved);
  const grandParent = path.basename(path.dirname(parent));
  const managed =
    parent === path.join(realpathOr(globalDir()), "agents") ||
    (path.basename(parent) === "agents" &&
      (grandParent === ".tnt" || grandParent === ".claude")) ||
    (workspacePath !== undefined &&
      parent === path.join(workspacePath, ".tnt", "agents"));
  if (!managed || path.extname(resolved) !== ".md") {
    throw new Error(
      `${UNAVAILABLE}: subagents: ${resolved} is not an agent file in a managed directory`,
    );
  }
  return resolved;
}

function realpathOr(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

function writeAgent(
  config: SubAgentConfig,
  scope: "workspace" | "user",
  workspacePath: string | undefined,
  keepPath?: string,
): string {
  const name = config.name?.trim();
  if (!name) {
    throw new Error(`${UNAVAILABLE}: subagents: an agent needs a name`);
  }
  if (BUILT_IN_AGENTS.some((agent) => agent.name === name)) {
    throw new Error(
      `${UNAVAILABLE}: subagents: "${name}" is a built-in agent name`,
    );
  }
  if (!config.systemPrompt?.trim()) {
    throw new Error(
      `${UNAVAILABLE}: subagents: an agent needs a system prompt`,
    );
  }
  const root = managedAgentRoot(
    scope === "workspace" ? workspacePath : undefined,
  );
  // Editing a file from a compatible directory (`.claude/agents`) keeps it
  // where it is; a rename writes the same directory, not a duplicate.
  const directory =
    keepPath && path.basename(path.dirname(keepPath)) === "agents"
      ? path.dirname(keepPath)
      : root;
  const file = path.join(
    directory,
    `${
      name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "agent"
    }.md`,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    serializeAgentMarkdown({
      name,
      description: config.description ?? "",
      systemPrompt: config.systemPrompt,
      ...(config.color ? { color: config.color } : {}),
      ...(config.modelSelection
        ? { model: config.modelSelection.modelId }
        : {}),
      ...(config.tools ? { tools: config.tools } : {}),
      ...(config.disallowedTools
        ? { disallowedTools: config.disallowedTools }
        : {}),
      ...(config.permissionMode
        ? { permissionMode: config.permissionMode }
        : {}),
      ...(typeof config.maxTurns === "number"
        ? { maxTurns: config.maxTurns }
        : {}),
      ...(typeof config.background === "boolean"
        ? { background: config.background }
        : {}),
      ...(config.skills ? { skills: config.skills } : {}),
    }),
    { mode: 0o600 },
  );
  if (keepPath && path.resolve(keepPath) !== path.resolve(file)) {
    rmSync(keepPath, { force: true });
  }
  return file;
}

export function createTntSubagentsService(): ISubagentsService {
  return {
    async list({ workspacePath }): Promise<AgentsListResult> {
      const markdown = loadMarkdownAgents(workspacePath).map(markdownSummary);
      const builtIns = [...BUILT_IN_AGENTS]
        .map(builtInSummary)
        .filter(
          (agent) =>
            !markdown.some(
              (declared) =>
                declared.name.toLowerCase() === agent.name.toLowerCase(),
            ),
        );
      const configured = configuredSubagents()
        .filter(
          (model) =>
            !builtIns.some(
              (agent) => agent.name.toLowerCase() === model.name?.toLowerCase(),
            ) &&
            !markdown.some(
              (agent) => agent.name.toLowerCase() === model.name?.toLowerCase(),
            ),
        )
        .map(configuredSummary);
      const plugin = pluginSummaries();
      return {
        agents: [...builtIns, ...configured, ...markdown, ...plugin],
        userAgents: markdown.filter((agent) => agent.scope === "user"),
        pluginAgents: plugin,
        capability: { userScopeAvailable: true },
      };
    },

    async setEnabled({ agentId, enabled }) {
      if (agentId.startsWith("config:")) {
        throw new Error(
          `${UNAVAILABLE}: subagents: agents declared in config.yaml are removed there, not disabled here`,
        );
      }
      setSubagentEnabled(agentId, enabled);
    },

    async setBuiltInModelOverride({ agentName, modelSelection }) {
      setSubagentModelOverride(
        subagentStateKey("builtin", agentName),
        modelSelectionFrom(modelSelection),
      );
    },

    async setPluginAgentModelOverride({ agentId, modelSelection }) {
      setSubagentModelOverride(agentId, modelSelectionFrom(modelSelection));
    },

    async getPrimaryUserAgentsDirectory() {
      return { path: path.join(globalDir(), "agents") };
    },

    async createAgent({ config, scope, workspacePath }) {
      const file = writeAgent(config, scope ?? "user", workspacePath);
      const agent = loadMarkdownAgents(workspacePath).find(
        (candidate) => candidate.name === config.name?.trim(),
      );
      if (!agent) {
        throw new Error(
          `${UNAVAILABLE}: subagents: the agent was written to ${file} but could not be read back`,
        );
      }
      return { agent: markdownSummary(agent) };
    },

    async updateAgent({ agentId, config, oldFilePath, scope, workspacePath }) {
      const existing = oldFilePath
        ? assertManagedAgentPath(oldFilePath, workspacePath)
        : undefined;
      writeAgent(
        config,
        scope ?? "user",
        workspacePath,
        existing ?? oldFilePath ?? undefined,
      );
      const agent = loadMarkdownAgents(workspacePath).find(
        (candidate) => candidate.name === config.name?.trim(),
      );
      if (!agent) {
        throw new Error(
          `${UNAVAILABLE}: subagents: the agent was written but could not be read back`,
        );
      }
      const nextKey = subagentStateKey("markdown", agent.name, agent.scope);
      if (agentId && agentId !== nextKey) {
        removeSubagentPreference(agentId);
      }
      return { agent: markdownSummary(agent) };
    },

    async deleteAgent({ agentId, filePath }) {
      const resolved = assertManagedAgentPath(filePath);
      rmSync(resolved, { force: true });
      if (agentId) {
        removeSubagentPreference(agentId);
      }
    },
  };
}
