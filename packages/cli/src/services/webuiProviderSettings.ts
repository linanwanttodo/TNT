/* eslint-disable max-lines -- one module owns the TNT model <-> ZCode provider mapping, its file edits and its shell-side state. */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { Emitter } from "@zcode/rpc";
import type {
  IProviderSettingsService,
  ProviderSettingsProviderView,
  ProviderSettingsView,
} from "@zcode/services";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { globalDir } from "../config/globalDir.js";
import { createLlmApi } from "../config/index.js";
import { CONFIG_PATH } from "../config/providerSetup.js";
import { logger } from "../utils/logger.js";
import {
  registryModelConfig,
  type TntModelEntry,
} from "../webuiZcode/services/modelSelection.js";

import type { ConfigServiceState } from "./types.js";

import { reloadService, serviceContainer, SERVICE_NAMES } from "./index.js";

export const WEBUI_PROVIDERS_FILE = "webui-providers.json";

type ModelView = ProviderSettingsView["providers"][number]["models"][number];
type TemplateView = ProviderSettingsView["providerTemplates"][number];
type ProviderOverlay = Parameters<
  IProviderSettingsService["savePersonalProviderOverlay"]
>[1];
type ProviderOverlayMetadata = Parameters<
  IProviderSettingsService["savePersonalProviderOverlay"]
>[2];
type SaveModelDraftInput = Parameters<
  IProviderSettingsService["savePersonalModelDraft"]
>[0];

/** One `models:` entry of TNT's config.yaml, kept loose: unknown keys survive. */
export interface RawModelEntry extends TntModelEntry {
  apiKey?: string;
  defaultCompletionOptions?: { maxTokens?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ProviderSettingsConfigSnapshot {
  configPath?: string;
  models: RawModelEntry[];
}

/**
 * Where the service gets facts and applies writes. The default reads the live
 * CONFIG state and rewrites the active config.yaml; tests inject a temporary
 * file so the mapping is exercised without the service container.
 */
export interface ProviderSettingsIO {
  read(): Promise<ProviderSettingsConfigSnapshot | null>;
  /** Applies the update to the file's `models:` list and persists it. */
  writeModels(
    update: (models: RawModelEntry[]) => RawModelEntry[],
  ): Promise<void>;
  /** Re-runs the config/model services so turns see the new list. */
  reload(): Promise<void>;
}

interface ProviderOverlayValues {
  baseUrl?: string;
  apiKey?: string;
  useResponsesApi?: boolean;
}

interface ProviderShellState {
  /** Shell-side display names per provider family. */
  names: Record<string, string>;
  order: string[];
  /** Providers created but not yet backed by a model entry. */
  drafts: Array<{ id: string; family: string; name: string }>;
  /** Endpoint and key typed before the first model entry exists. */
  overlays: Record<string, ProviderOverlayValues>;
}

const EMPTY_STATE: ProviderShellState = {
  names: {},
  order: [],
  drafts: [],
  overlays: {},
};

/** TNT families the settings picker offers, with the protocol each speaks. */
const PROVIDER_TEMPLATES: ReadonlyArray<{
  family: string;
  label: string;
  apiType?:
    "openai-chat-completions" | "openai-responses" | "anthropic-messages";
}> = [
  { family: "openai", label: "OpenAI", apiType: "openai-chat-completions" },
  { family: "anthropic", label: "Anthropic", apiType: "anthropic-messages" },
  { family: "gemini", label: "Gemini" },
  { family: "ollama", label: "Ollama" },
];

/** The TNT provider family a ZCode protocol selects, when it maps to one. */
function familyForApiType(
  apiType: string | null | undefined,
): string | undefined {
  if (apiType === "anthropic-messages") {
    return "anthropic";
  }
  if (apiType === "openai-chat-completions" || apiType === "openai-responses") {
    return "openai";
  }
  return undefined;
}

function apiTypeForFamily(
  family: string,
  useResponsesApi: boolean | undefined,
): TemplateView["config"]["api"] | undefined {
  if (family === "anthropic") {
    return { type: "anthropic-messages" };
  }
  if (family === "openai") {
    return {
      type: useResponsesApi ? "openai-responses" : "openai-chat-completions",
    };
  }
  return undefined;
}

function isChatEnabled(entry: RawModelEntry): boolean {
  return entry.roles === undefined || entry.roles.includes("chat");
}

function modelFields(config: unknown): {
  contextLength?: number;
  maxTokens?: number;
} {
  const record = config as
    | {
        properties?: { contextWindow?: unknown };
        optionSpecs?: { maxOutputTokens?: { max?: unknown } };
      }
    | null
    | undefined;
  const contextLength = record?.properties?.contextWindow;
  const maxTokens = record?.optionSpecs?.maxOutputTokens?.max;
  return {
    ...(typeof contextLength === "number" && contextLength > 0
      ? { contextLength }
      : {}),
    ...(typeof maxTokens === "number" && maxTokens > 0 ? { maxTokens } : {}),
  };
}

function shellStateFile(): string {
  return path.join(globalDir(), WEBUI_PROVIDERS_FILE);
}

/** The loaded config's path when a boot reached it, else the default file. */
function defaultConfigPath(): string {
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

function readShellState(filePath: string): ProviderShellState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...EMPTY_STATE };
    }
    const record = parsed as Partial<ProviderShellState>;
    const overlays: Record<string, ProviderOverlayValues> = {};
    if (record.overlays && typeof record.overlays === "object") {
      for (const [family, value] of Object.entries(
        record.overlays as Record<string, unknown>,
      )) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const entry = value as Record<string, unknown>;
        overlays[family] = {
          ...(typeof entry.baseUrl === "string" && entry.baseUrl
            ? { baseUrl: entry.baseUrl }
            : {}),
          ...(typeof entry.apiKey === "string" && entry.apiKey
            ? { apiKey: entry.apiKey }
            : {}),
          ...(typeof entry.useResponsesApi === "boolean"
            ? { useResponsesApi: entry.useResponsesApi }
            : {}),
        };
      }
    }
    return {
      names:
        record.names && typeof record.names === "object" ? record.names : {},
      overlays,
      order: Array.isArray(record.order)
        ? record.order.filter((id) => typeof id === "string")
        : [],
      drafts: Array.isArray(record.drafts)
        ? record.drafts.filter(
            (draft): draft is ProviderShellState["drafts"][number] =>
              Boolean(draft) &&
              typeof draft.id === "string" &&
              typeof draft.family === "string" &&
              typeof draft.name === "string",
          )
        : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeShellState(filePath: string, state: ProviderShellState): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Mode is best effort on platforms without chmod.
  }
}

/**
 * The production wiring: the config file itself is the source of truth, so the
 * settings page works before (and instead of) a successful service boot - an
 * unconfigured model is exactly what this page exists to fix. After a write the
 * config/model services are reloaded when they were already registered; a daemon
 * that never initialized leaves that to the first turn's lazy entry.
 */
function defaultIO(configPath: () => string): ProviderSettingsIO {
  const readFileModels = (): ProviderSettingsConfigSnapshot => {
    const file = configPath();
    const document = parseYaml(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    > | null;
    const models = Array.isArray(document?.models)
      ? (document!.models as RawModelEntry[])
      : [];
    return { configPath: file, models };
  };
  const reloadIfRegistered = async (): Promise<void> => {
    if (!serviceContainer.has(SERVICE_NAMES.CONFIG)) {
      return;
    }
    const state = serviceContainer.getSync<ConfigServiceState>(
      SERVICE_NAMES.CONFIG,
    );
    if (state.state === "idle") {
      return;
    }
    try {
      await reloadService(SERVICE_NAMES.CONFIG);
    } catch (error) {
      logger.debug("webui provider settings: reload failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return {
    async read() {
      try {
        return readFileModels();
      } catch (error) {
        logger.debug("webui provider settings: config unreadable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    async writeModels(update) {
      const file = configPath();
      const document = parseYaml(readFileSync(file, "utf8")) as Record<
        string,
        unknown
      > | null;
      const current = Array.isArray(document?.models)
        ? (document!.models as RawModelEntry[])
        : [];
      const updated = { ...(document ?? {}), models: update(current) };
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, stringifyYaml(updated), { mode: 0o600 });
      renameSync(temporary, file);
      try {
        chmodSync(file, 0o600);
      } catch {
        // Mode is best effort on platforms without chmod.
      }
      await reloadIfRegistered();
    },
    async reload() {
      await reloadIfRegistered();
    },
  };
}

function modelView(entry: RawModelEntry): ModelView {
  const personal = registryModelConfig(entry);
  return {
    kind: "candidate",
    modelId: entry.name,
    builtin: false,
    effectiveBuiltinConfig: {},
    personalExactConfig: personal,
    useRecommendedConfig: false,
    effectiveConfig: personal,
    enabled: isChatEnabled(entry),
    executable: true,
    selectable: true,
    issues: [],
  };
}

function providerView(
  family: string,
  entries: RawModelEntry[],
  state: ProviderShellState,
): ProviderSettingsProviderView {
  const first = entries[0];
  // The overlay is what the form last saved. A provider without a model has
  // no entry to carry it, and a quick "fill the key, add a model" sequence can
  // reach the model editor before the next entry is written; the form must
  // still show, and the model must still inherit, the values that were typed.
  const overlay = state.overlays[family];
  const baseUrl = overlay?.baseUrl ?? first?.apiBase;
  const apiKey = overlay?.apiKey ?? first?.apiKey;
  const useResponsesApi = overlay?.useResponsesApi ?? first?.useResponsesApi;
  const apiType = apiTypeForFamily(family, useResponsesApi);
  const api = apiType
    ? {
        type: apiType.type,
        ...(baseUrl ? { baseUrl } : {}),
      }
    : undefined;
  const access = { type: "api-key" as const, apiKey: apiKey ?? "" };
  const personalConfig = {
    group: "standard-personal" as const,
    visibility: "visible" as const,
    access: { type: "api-key" as const },
    ...(api ? { api } : {}),
  };
  return {
    providerId: family,
    providerName: state.names[family] ?? providerLabel(family),
    templateId: family,
    enabled: true,
    executable: entries.length > 0,
    personalConfig,
    effectiveConfig: {
      ...personalConfig,
      access,
      ...(api ? { api } : {}),
    },
    issues: [],
    models: entries.map(modelView),
  };
}

function providerLabel(family: string): string {
  const template = PROVIDER_TEMPLATES.find((item) => item.family === family);
  if (template) {
    return template.label;
  }
  return family.charAt(0).toUpperCase() + family.slice(1);
}

function templateViews(families: readonly string[]): TemplateView[] {
  const known = new Map(PROVIDER_TEMPLATES.map((item) => [item.family, item]));
  const extra = families
    .filter((family) => !known.has(family))
    .map((family) => ({
      family,
      label: providerLabel(family),
      apiType: undefined,
    }));
  return [...PROVIDER_TEMPLATES, ...extra].map((item) => ({
    templateId: item.family,
    templateNameMap: { "zh-CN": item.label, "en-US": item.label },
    config: {
      visibility: "visible" as const,
      ...(item.apiType ? { api: { type: item.apiType } } : {}),
    },
  }));
}

export function buildProviderSettingsView(
  snapshot: ProviderSettingsConfigSnapshot | null,
  state: ProviderShellState,
  revision: number,
): ProviderSettingsView {
  const groups = new Map<string, RawModelEntry[]>();
  for (const entry of snapshot?.models ?? []) {
    const family = entry.provider || "tnt";
    const list = groups.get(family);
    if (list) {
      list.push(entry);
    } else {
      groups.set(family, [entry]);
    }
  }
  for (const draft of state.drafts) {
    if (!groups.has(draft.family)) {
      groups.set(draft.family, []);
    }
  }
  // An endpoint typed before its first model is still a provider the page
  // shows; otherwise the form would blank the values the user just saved.
  for (const family of Object.keys(state.overlays)) {
    if (!groups.has(family)) {
      groups.set(family, []);
    }
  }
  const families = [...groups.keys()];
  const ordered = [
    ...state.order.filter((family) => groups.has(family)),
    ...families.filter((family) => !state.order.includes(family)),
  ];
  return {
    revision,
    providerTemplates: templateViews(families),
    providerOrder: ordered,
    providers: ordered.map((family) =>
      providerView(family, groups.get(family) ?? [], state),
    ),
  };
}

/**
 * TNT has no provider database: a provider is the `provider:` family its
 * `models:` entries name, so the settings page edits that list directly. The
 * shell-side state file only holds what the model file cannot express - the
 * display names, the order, and a provider created before its first model.
 */
export function createWebUiProviderSettingsService(
  options: {
    io?: ProviderSettingsIO;
    stateFile?: string;
    /** The config file the page edits; defaults to the active/default path. */
    configPath?: () => string;
  } = {},
): IProviderSettingsService {
  const io = options.io ?? defaultIO(options.configPath ?? defaultConfigPath);
  const stateFile = options.stateFile ?? shellStateFile();
  const changed = new Emitter<ProviderSettingsView>();
  let revision = 0;
  let inflight: Promise<ProviderSettingsView> | null = null;
  // A provider created before its first model has nowhere to keep its endpoint
  // and key: config.yaml only stores complete model entries. Hold the pending
  // overlay in memory (never on disk twice) until the first model lands.
  const pendingOverlays = new Map<
    string,
    { baseUrl?: string; apiKey?: string; useResponsesApi?: boolean }
  >();

  const snapshotState = (): ProviderShellState => readShellState(stateFile);
  const updateState = (
    update: (state: ProviderShellState) => ProviderShellState,
  ): void => {
    writeShellState(stateFile, update(snapshotState()));
  };

  const view = async (): Promise<ProviderSettingsView> => {
    const snapshot = await io.read();
    revision += 1;
    return buildProviderSettingsView(snapshot, snapshotState(), revision);
  };

  const mutate = async (
    update: (models: RawModelEntry[]) => RawModelEntry[],
  ): Promise<ProviderSettingsView> => {
    // One file rewrite at a time: concurrent form saves must not interleave
    // read-modify-write cycles on the same YAML document.
    const previous = inflight ?? Promise.resolve(await view());
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        await io.writeModels(update);
        return view();
      });
    inflight = run;
    try {
      const next = await run;
      changed.fire(next);
      return next;
    } finally {
      if (inflight === run) {
        inflight = null;
      }
    }
  };

  return {
    onDidChange: changed.event,
    async getView() {
      return view();
    },
    async refresh() {
      return view();
    },
    async resolveModelConfig(input) {
      return {
        inheritedConfig: {},
        effectiveConfig:
          "personalConfig" in input && input.personalConfig
            ? (input.personalConfig as Record<string, unknown>)
            : registryModelConfig({
                name: input.modelId,
                provider: input.providerId,
                model: input.modelId,
              }),
        issues: [],
      };
    },
    async createPersonalProvider(input) {
      const state = snapshotState();
      const templateId = input?.templateId?.trim();
      const family =
        (templateId
          ? (familyForApiType(
              PROVIDER_TEMPLATES.find((item) => item.family === templateId)
                ?.apiType,
            ) ?? templateId)
          : undefined) ?? "openai";
      const existing = new Set([
        ...state.drafts.map((draft) => draft.id),
        ...((await io.read())?.models.map((entry) => entry.provider || "tnt") ??
          []),
      ]);
      // Providers are family-keyed: creating one over a family that already has
      // models means editing that family, not a second card with another id.
      const id = family;
      if (!existing.has(family)) {
        const name = input?.providerName?.trim() || providerLabel(family);
        updateState((current) => ({
          ...current,
          drafts: [...current.drafts, { id, family, name }],
        }));
      }
      const next = await view();
      changed.fire(next);
      return { providerId: id, view: next };
    },
    savePersonalProviderOverlay(
      providerId: string,
      config: ProviderOverlay,
      metadata?: ProviderOverlayMetadata,
    ) {
      const state = snapshotState();
      const draft = state.drafts.find((item) => item.id === providerId);
      const family = draft?.family ?? providerId;
      const apiType = config.api?.type;
      const baseUrl = config.api?.baseUrl ?? undefined;
      const access = config.access;
      const apiKey =
        access && "apiKey" in access ? (access.apiKey ?? undefined) : undefined;
      const overlayName = metadata?.providerName?.trim();
      const nextFamily = familyForApiType(apiType) ?? (family || "openai");
      const values: ProviderOverlayValues = {
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(apiType ? { useResponsesApi: apiType === "openai-responses" } : {}),
      };
      if (draft) {
        pendingOverlays.set(providerId, values);
      }
      updateState((current) => ({
        ...current,
        names: overlayName
          ? { ...current.names, [nextFamily]: overlayName }
          : current.names,
        drafts: current.drafts.map((item) =>
          item.id === providerId ? { ...item, family: nextFamily } : item,
        ),
        overlays: {
          ...current.overlays,
          [nextFamily]: {
            ...current.overlays[nextFamily],
            ...values,
          },
        },
      }));
      return mutate((models) =>
        models.map((entry) => {
          if ((entry.provider || "tnt") === family) {
            return {
              ...entry,
              ...(nextFamily === family ? {} : { provider: nextFamily }),
              ...(baseUrl ? { apiBase: baseUrl } : {}),
              ...(apiKey ? { apiKey } : {}),
              ...(apiType
                ? { useResponsesApi: apiType === "openai-responses" }
                : {}),
            };
          }
          return entry;
        }),
      );
    },
    deletePersonalProvider(providerId: string) {
      const state = snapshotState();
      const draft = state.drafts.find((item) => item.id === providerId);
      const family = draft?.family ?? providerId;
      updateState((current) => ({
        ...current,
        drafts: current.drafts.filter((item) => item.id !== providerId),
        order: current.order.filter((item) => item !== family),
        names: Object.fromEntries(
          Object.entries(current.names).filter(([key]) => key !== family),
        ),
      }));
      pendingOverlays.delete(providerId);
      return mutate((models) =>
        models.filter((entry) => (entry.provider || "tnt") !== family),
      );
    },
    reorderPersonalProviders(providerIds) {
      updateState((current) => ({
        ...current,
        order: providerIds.filter((id) => typeof id === "string"),
      }));
      return view().then((next) => {
        changed.fire(next);
        return next;
      });
    },
    reorderPersonalModels(providerId, modelIds) {
      const state = snapshotState();
      const family =
        state.drafts.find((item) => item.id === providerId)?.family ??
        providerId;
      const rank = new Map(modelIds.map((id, index) => [id, index]));
      return mutate((models) => {
        const familyEntries = models.filter(
          (entry) => (entry.provider || "tnt") === family,
        );
        familyEntries.sort(
          (left, right) =>
            (rank.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(right.name) ?? Number.MAX_SAFE_INTEGER),
        );
        let cursor = 0;
        return models.map((entry) =>
          (entry.provider || "tnt") === family
            ? familyEntries[cursor++]!
            : entry,
        );
      });
    },
    addPersonalModel(providerId, modelId, config, _useRecommendedConfig) {
      const state = snapshotState();
      const draft = state.drafts.find((item) => item.id === providerId);
      const family = draft?.family ?? providerId;
      const pending =
        (draft ? pendingOverlays.get(draft.id) : undefined) ??
        state.overlays[family];
      const fields = modelFields(config);
      return mutate((models) => {
        const sibling = models.find(
          (entry) => (entry.provider || "tnt") === family,
        );
        const apiKey = sibling?.apiKey ?? pending?.apiKey;
        const apiBase = sibling?.apiBase ?? pending?.baseUrl;
        const useResponsesApi =
          sibling?.useResponsesApi ?? pending?.useResponsesApi ?? false;
        const entry: RawModelEntry = {
          name: modelId,
          model: modelId,
          provider: family,
          roles: ["chat"],
          ...(apiBase ? { apiBase } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(family === "openai" ? { useResponsesApi } : {}),
          ...(fields.contextLength
            ? { contextLength: fields.contextLength }
            : {}),
          ...(fields.maxTokens
            ? { defaultCompletionOptions: { maxTokens: fields.maxTokens } }
            : {}),
        };
        const next = [
          ...models.filter(
            (candidate) =>
              !(
                (candidate.provider || "tnt") === family &&
                candidate.name === modelId
              ),
          ),
          entry,
        ];
        if (draft) {
          updateState((current) => ({
            ...current,
            drafts: current.drafts.filter((item) => item.id !== draft.id),
            order: current.order.includes(family)
              ? current.order
              : [...current.order, family],
          }));
        }
        return next;
      });
    },
    renamePersonalModel(providerId, currentModelId, nextModelId) {
      const state = snapshotState();
      const family =
        state.drafts.find((item) => item.id === providerId)?.family ??
        providerId;
      return mutate((models) =>
        models.map((entry) =>
          (entry.provider || "tnt") === family && entry.name === currentModelId
            ? // The name is TNT's local alias; the provider's wire model id stays.
              { ...entry, name: nextModelId }
            : entry,
        ),
      );
    },
    deletePersonalModel(providerId, modelId) {
      const state = snapshotState();
      const family =
        state.drafts.find((item) => item.id === providerId)?.family ??
        providerId;
      return mutate((models) =>
        models.filter(
          (entry) =>
            !((entry.provider || "tnt") === family && entry.name === modelId),
        ),
      );
    },
    savePersonalModelDraft(input: SaveModelDraftInput) {
      const state = snapshotState();
      const family =
        state.drafts.find((item) => item.id === input.providerId)?.family ??
        input.providerId;
      const fields = modelFields(input.personalConfig);
      return mutate((models) =>
        models.map((entry) => {
          if (
            (entry.provider || "tnt") !== family ||
            entry.name !== input.originalModelId
          ) {
            return entry;
          }
          return {
            ...entry,
            name: input.nextModelId,
            ...(fields.contextLength
              ? { contextLength: fields.contextLength }
              : {}),
            ...(fields.maxTokens
              ? { defaultCompletionOptions: { maxTokens: fields.maxTokens } }
              : {}),
          };
        }),
      );
    },
    setPersonalModelEnabled(providerId, modelId, enabled) {
      const state = snapshotState();
      const family =
        state.drafts.find((item) => item.id === providerId)?.family ??
        providerId;
      return mutate((models) =>
        models.map((entry) => {
          if ((entry.provider || "tnt") !== family || entry.name !== modelId) {
            return entry;
          }
          const roles = (entry.roles ?? []).filter((role) => role !== "chat");
          return { ...entry, roles: enabled ? ["chat", ...roles] : roles };
        }),
      );
    },
    async testModelConnectivity(input) {
      const state = snapshotState();
      const family =
        state.drafts.find((item) => item.id === input.providerId)?.family ??
        input.providerId;
      const snapshot = await io.read();
      const entry = snapshot?.models.find(
        (candidate) =>
          (candidate.provider || "tnt") === family &&
          candidate.name === input.modelId,
      );
      if (!entry) {
        return {
          success: false,
          error: {
            code: "model-unavailable",
            message: "This model is not in the saved configuration.",
          },
        };
      }
      // The entry is a config-yaml ModelConfig plus shell fields the adapter ignores.
      const api = createLlmApi(
        entry as unknown as Parameters<typeof createLlmApi>[0],
      );
      if (!api) {
        return {
          success: false,
          error: {
            code: "model-unavailable",
            message: "TNT has no adapter for this model's provider.",
          },
        };
      }
      try {
        await api.chatCompletionNonStream(
          {
            model: entry.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 8,
            stream: false,
          },
          AbortSignal.timeout(20_000),
        );
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}
