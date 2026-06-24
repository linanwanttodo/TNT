/**
 * The model configuration store behind the web UI's Models settings page.
 *
 * `modelCatalog.ts` answers "which chat model is this process running" and
 * moves between existing entries; this file owns the entries themselves. They
 * live in the same config.yaml the CLI reads (`models:` list, `model:`
 * selection), so the CRUD here edits that file through the YAML document
 * model - comments and ordering survive the round trip - and then reloads the
 * config and model services, so a change the browser wrote is one the running
 * process already uses. No restart, no hand-edited YAML.
 */
import fs from "fs";

import { writeFileAtomically } from "core/util/atomicWrite.js";
import { setConfigFilePermissions } from "core/util/paths.js";
import YAML from "yaml";

import { createLlmApi } from "../config/index.js";
import { defaultConfigPath } from "../config/modelSelection.js";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";

import { applyModelPatch, validateModelPatch } from "./modelConfigPatch.js";
import type { ToolPermissionServiceState } from "./ToolPermissionService.js";
import type {
  AgentFileServiceState,
  ApiClientServiceState,
  ConfigServiceState,
} from "./types.js";

import { SERVICE_NAMES, serviceContainer, services } from "./index.js";

/** The roles a model entry may declare, mirroring @tnt/config-yaml's schema. */
export const MODEL_ROLES = [
  "chat",
  "edit",
  "apply",
  "autocomplete",
  "embed",
  "rerank",
  "subagent",
] as const;

/** One config.yaml model entry, as the settings page edits it. */
export interface DeclaredModel {
  name: string;
  /** The provider's model id (the `model:` field of the entry). */
  model: string;
  provider: string;
  /** Whether an apiKey is set; the secret itself never leaves the process. */
  hasApiKey: boolean;
  apiBase: string | null;
  roles: string[];
  contextLength: number | null;
}

/** The writable fields of a model entry, as POST /models accepts them. */
export interface ModelConfigInput {
  name: string;
  model: string;
  provider: string;
  apiKey?: string;
  apiBase?: string;
  roles?: string[];
  contextLength?: number;
}

export interface ModelConfigMutationResult {
  declared: DeclaredModel[];
  configPath: string;
}

export const EDITABLE_ROLES = new Set<string>(MODEL_ROLES);

function configPathForModels(): string {
  const configState = services.config.getState() as ConfigServiceState;
  return configState.configPath ?? defaultConfigPath();
}

/**
 * Read config.yaml through the YAML document model and project its `models:`
 * entries. A file that does not exist answers empty: the caller offers to
 * create the first entry, which also creates the file.
 */
export function readDeclaredModels(
  file: string = configPathForModels(),
): DeclaredModel[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    logger.warn(
      "Failed to parse config.yaml for the model list",
      error as Error,
    );
    throw new Error(
      t("services.modelConfig.parseFailed", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const models = doc.get("models");
  if (!YAML.isSeq(models)) {
    return [];
  }
  const declared: DeclaredModel[] = [];
  for (const item of models.items) {
    if (!YAML.isMap(item)) continue;
    const name = item.get("name");
    const model = item.get("model");
    const provider = item.get("provider");
    if (typeof name !== "string" || typeof provider !== "string") continue;
    declared.push({
      name,
      model: typeof model === "string" ? model : name,
      provider,
      hasApiKey: typeof item.get("apiKey") === "string",
      apiBase:
        typeof item.get("apiBase") === "string"
          ? (item.get("apiBase") as string)
          : null,
      roles: Array.isArray(item.get("roles"))
        ? (item.get("roles") as string[])
        : [],
      contextLength:
        typeof item.get("contextLength") === "number"
          ? (item.get("contextLength") as number)
          : null,
    });
  }
  return declared;
}

/** The names `model:` currently points at, or null when no selection exists. */
function readSelectedModel(doc: YAML.Document): string | null {
  const selected = doc.get("model");
  return typeof selected === "string" && selected.trim()
    ? selected.trim()
    : null;
}

/**
 * Validate a create/update payload. The error message names the field so the
 * form can point at it; roles outside the known set are refused because the
 * unroll step would drop them silently.
 */
export function validateModelInput(input: ModelConfigInput): string | null {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return t("services.modelConfig.nameRequired");
  }
  if (typeof input.model !== "string" || input.model.trim() === "") {
    return t("services.modelConfig.modelRequired");
  }
  if (typeof input.provider !== "string" || input.provider.trim() === "") {
    return t("services.modelConfig.providerRequired");
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== "string") {
    return t("services.modelConfig.apiKeyString");
  }
  if (
    input.apiBase !== undefined &&
    input.apiBase !== null &&
    input.apiBase !== "" &&
    typeof input.apiBase === "string"
  ) {
    try {
      new URL(input.apiBase);
    } catch {
      return t("services.modelConfig.apiBaseInvalid");
    }
  }
  if (
    input.roles !== undefined &&
    (!Array.isArray(input.roles) ||
      input.roles.some((role) => !EDITABLE_ROLES.has(role)))
  ) {
    return t("services.modelConfig.rolesInvalid", {
      roles: MODEL_ROLES.join(", "),
    });
  }
  if (
    input.contextLength !== undefined &&
    input.contextLength !== null &&
    (typeof input.contextLength !== "number" ||
      !Number.isInteger(input.contextLength) ||
      input.contextLength <= 0)
  ) {
    return t("services.modelConfig.contextLengthInvalid");
  }
  return null;
}

/** Reject a create whose name would collide with an existing entry. */
function assertNameAvailable(doc: YAML.Document, name: string): void {
  const models = doc.get("models");
  if (!YAML.isSeq(models)) return;
  for (const item of models.items) {
    if (YAML.isMap(item) && item.get("name") === name) {
      throw new Error(t("services.modelConfig.nameExists", { name }));
    }
  }
}

/**
 * One write cycle: persist the document (creating the file when absent) with
 * the platform's config permissions. Callers mutate the document first.
 */
function writeModelDoc(file: string, doc: YAML.Document): void {
  writeFileAtomically(file, doc.toString());
  setConfigFilePermissions(file);
}

/**
 * Add a model entry to config.yaml. The written entry defaults to a chat
 * role when the caller sends none, so a model added from the web UI shows up
 * in the chat model list immediately.
 */
export async function addDeclaredModel(
  input: ModelConfigInput,
): Promise<ModelConfigMutationResult> {
  const problem = validateModelInput(input);
  if (problem) {
    throw new Error(problem);
  }

  const file = configPathForModels();
  const doc = fs.existsSync(file)
    ? YAML.parseDocument(fs.readFileSync(file, "utf-8"))
    : new YAML.Document({ name: "Agent", schema: "v1", version: "0.0.1" });

  assertNameAvailable(doc, input.name.trim());

  const seq = (() => {
    const existing = doc.get("models");
    if (YAML.isSeq(existing)) return existing;
    const fresh = new YAML.YAMLSeq();
    doc.set("models", fresh);
    return fresh;
  })();

  const entry = new YAML.YAMLMap();
  entry.set("name", input.name.trim());
  entry.set("model", input.model.trim());
  entry.set("provider", input.provider.trim());
  if (input.apiKey && input.apiKey.trim() !== "") {
    entry.set("apiKey", input.apiKey.trim());
  }
  if (input.apiBase && input.apiBase.trim() !== "") {
    entry.set("apiBase", input.apiBase.trim());
  }
  if (input.roles && input.roles.length > 0) {
    entry.set(
      "roles",
      Array.from(new Set([...input.roles, "chat"])).filter((role) =>
        EDITABLE_ROLES.has(role),
      ),
    );
  } else {
    entry.set("roles", ["chat"]);
  }
  if (input.contextLength && input.contextLength > 0) {
    entry.set("contextLength", input.contextLength);
  }
  seq.add(entry);

  writeModelDoc(file, doc);
  await reloadConfiguredModels();
  return { declared: readDeclaredModels(file), configPath: file };
}

/**
 * Patch an existing entry by name. Fields the patch omits stay as they are;
 * an apiKey of "" leaves the stored key untouched, because the form only
 * resends the secret when the user typed a new one.
 */
export async function updateDeclaredModel(
  name: string,
  patch: Partial<ModelConfigInput>,
): Promise<ModelConfigMutationResult> {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(t("services.modelConfig.nameRequired"));
  }

  const file = configPathForModels();
  if (!fs.existsSync(file)) {
    throw new Error(t("services.modelConfig.noConfigFile", { path: file }));
  }
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf-8"));

  const models = doc.get("models");
  if (!YAML.isSeq(models)) {
    throw new Error(
      t("services.modelConfig.noModelNamed", { name, path: file }),
    );
  }
  const entry = models.items.find(
    (item): item is YAML.YAMLMap =>
      YAML.isMap(item) && item.get("name") === name,
  );
  if (!entry) {
    throw new Error(
      t("services.modelConfig.noModelNamed", { name, path: file }),
    );
  }

  validateModelPatch(entry, name, patch);
  const renamed = patch.name?.trim();
  if (renamed !== undefined && renamed !== "" && renamed !== name) {
    assertNameAvailable(doc, renamed);
  }
  applyModelPatch(entry, name, patch);

  writeModelDoc(file, doc);
  await reloadConfiguredModels();
  return { declared: readDeclaredModels(file), configPath: file };
}

/**
 * Remove an entry by name. When the deleted entry was the selected model the
 * selection is cleared and the first remaining chat model takes over, so the
 * process never runs pointing at a name config.yaml no longer declares.
 */
export async function deleteDeclaredModel(
  name: string,
): Promise<ModelConfigMutationResult> {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(t("services.modelConfig.nameRequired"));
  }

  const file = configPathForModels();
  if (!fs.existsSync(file)) {
    throw new Error(t("services.modelConfig.noConfigFile", { path: file }));
  }
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf-8"));

  const models = doc.get("models");
  if (!YAML.isSeq(models)) {
    throw new Error(
      t("services.modelConfig.noModelNamed", { name, path: file }),
    );
  }
  const index = models.items.findIndex(
    (item) => YAML.isMap(item) && item.get("name") === name,
  );
  if (index === -1) {
    throw new Error(
      t("services.modelConfig.noModelNamed", { name, path: file }),
    );
  }
  models.delete(index);

  const selected = readSelectedModel(doc);
  if (selected === name) {
    const remaining = models.items.find((item): item is YAML.YAMLMap =>
      YAML.isMap(item),
    );
    if (remaining && typeof remaining.get("name") === "string") {
      doc.set("model", remaining.get("name"));
    } else {
      doc.delete("model");
    }
  }

  writeModelDoc(file, doc);
  await reloadConfiguredModels();
  return { declared: readDeclaredModels(file), configPath: file };
}

/**
 * Reorder the declared entries to match `names` exactly. The list must be a
 * permutation of what config.yaml declares - the drag-and-drop list reorders
 * existing entries, it never invents or drops one. The selection survives:
 * `model:` is a name, not a position.
 */
export async function reorderDeclaredModels(
  names: string[],
): Promise<ModelConfigMutationResult> {
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    names.some((name) => typeof name !== "string" || name.trim() === "")
  ) {
    throw new Error(t("services.modelConfig.nameRequired"));
  }

  const file = configPathForModels();
  if (!fs.existsSync(file)) {
    throw new Error(t("services.modelConfig.noConfigFile", { path: file }));
  }
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf-8"));
  const models = doc.get("models");
  if (!YAML.isSeq(models)) {
    throw new Error(
      t("services.modelConfig.noModelNamed", { name: names[0]!, path: file }),
    );
  }

  const byName = new Map<string, YAML.YAMLMap>();
  for (const item of models.items) {
    if (YAML.isMap(item) && typeof item.get("name") === "string") {
      byName.set(item.get("name") as string, item);
    }
  }

  const declared = new Set(byName.keys());
  const requested = new Set(names);
  if (requested.size !== names.length) {
    throw new Error(
      t("services.modelConfig.nameExists", { name: "(duplicate)" }),
    );
  }
  for (const name of names) {
    if (!declared.has(name)) {
      throw new Error(
        t("services.modelConfig.noModelNamed", { name, path: file }),
      );
    }
  }
  for (const name of declared) {
    if (!requested.has(name)) {
      throw new Error(
        t("services.modelConfig.noModelNamed", { name, path: file }),
      );
    }
  }

  const ordered = new YAML.YAMLSeq();
  for (const name of names) {
    ordered.add(byName.get(name)!);
  }
  doc.set("models", ordered);

  writeModelDoc(file, doc);
  await reloadConfiguredModels();
  return { declared: readDeclaredModels(file), configPath: file };
}

/**
 * Point the running process at the file it just changed: reload the config
 * service (which re-unrolls config.yaml) and then the model service, whose
 * initialize step picks up the freshly declared models and the `model:`
 * selection. A surface that never loaded its services (a test harness) skips
 * the reload rather than failing the write that already succeeded.
 */
export async function reloadConfiguredModels(): Promise<void> {
  try {
    const apiClientState = await serviceContainer.get<ApiClientServiceState>(
      SERVICE_NAMES.API_CLIENT,
    );
    const agentFileState = await serviceContainer.get<AgentFileServiceState>(
      SERVICE_NAMES.AGENT_FILE,
    );
    const toolPermissions =
      await serviceContainer.get<ToolPermissionServiceState>(
        SERVICE_NAMES.TOOL_PERMISSIONS,
      );

    await services.config.reload({
      apiClient: apiClientState.apiClient!,
      agentFileState,
      injectedConfigOptions: {},
      isHeadless: toolPermissions?.isHeadless,
    });
    await serviceContainer.reload(SERVICE_NAMES.MODEL);
  } catch (error) {
    // The file was written either way; a process that cannot hot-reload
    // (headless harnesses without a full container) keeps its previous
    // in-memory list and the user restarts to see the new one.
    logger.warn("Model config written but the services were not reloaded", {
      error,
    });
  }
}

/**
 * A real request to the provider, used by the settings page's "Test
 * connection" button. One tiny completion, 20s cap: long enough for a cold
 * provider, short enough that a hung endpoint does not hold the route.
 */
export async function testModelConnectivity(input: {
  provider: string;
  model: string;
  apiKey?: string;
  apiBase?: string;
}): Promise<{ ok: boolean; detail: string; latencyMs: number }> {
  if (
    typeof input.provider !== "string" ||
    typeof input.model !== "string" ||
    input.provider.trim() === "" ||
    input.model.trim() === ""
  ) {
    return {
      ok: false,
      detail: "provider and model are required",
      latencyMs: 0,
    };
  }

  const llmApi = createLlmApi({
    ...input,
    name: input.model,
  });
  if (!llmApi) {
    return {
      ok: false,
      detail: t("services.modelConfig.providerUnsupported", {
        provider: input.provider,
      }),
      latencyMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const startedAt = Date.now();
  try {
    const completion = await llmApi.chatCompletionNonStream(
      {
        model: input.model,
        messages: [{ role: "user", content: "Reply with the word: ok" }],
        max_tokens: 8,
      },
      controller.signal,
    );
    const text = completion.choices?.[0]?.message?.content;
    const detail =
      typeof text === "string" && text.trim() !== ""
        ? text.trim().slice(0, 120)
        : "the provider responded";
    return { ok: true, detail, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error as unknown);
    return {
      ok: false,
      detail: message.slice(0, 300),
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
