import YAML from "yaml";

import { t } from "../i18n/index.js";

import {
  EDITABLE_ROLES,
  MODEL_ROLES,
  validateModelInput,
  type ModelConfigInput,
} from "./modelConfigStore.js";

/**
 * The checks that must run before an entry is touched: a rename or model swap
 * has to still describe a usable entry, a posted apiBase has to parse, and the
 * roles have to be ones the form may set. Kept beside the store, not inside it,
 * so both stay under the line and complexity limits.
 */
export function validateModelPatch(
  entry: YAML.YAMLMap,
  name: string,
  patch: Partial<ModelConfigInput>,
): void {
  if (patch.name !== undefined || patch.model !== undefined) {
    const candidate: Partial<ModelConfigInput> = {
      name: (patch.name ?? name).trim(),
      model: (patch.model ??
        (typeof entry.get("model") === "string"
          ? (entry.get("model") as string)
          : name)) as string,
      provider: (patch.provider ??
        (typeof entry.get("provider") === "string"
          ? (entry.get("provider") as string)
          : "")) as string,
    };
    const problem = validateModelInput(candidate as ModelConfigInput);
    if (problem) {
      throw new Error(problem);
    }
  }
  if (typeof patch.apiBase === "string" && patch.apiBase !== "") {
    try {
      new URL(patch.apiBase);
    } catch {
      throw new Error(t("services.modelConfig.apiBaseInvalid"));
    }
  }
  if (
    patch.roles !== undefined &&
    (!Array.isArray(patch.roles) ||
      patch.roles.some((role) => !EDITABLE_ROLES.has(role)))
  ) {
    throw new Error(
      t("services.modelConfig.rolesInvalid", { roles: MODEL_ROLES.join(", ") }),
    );
  }
}

/** Write every field the patch actually carries, leaving the rest alone. */
export function applyModelPatch(
  entry: YAML.YAMLMap,
  name: string,
  patch: Partial<ModelConfigInput>,
): void {
  const renamed = patch.name?.trim();
  if (renamed !== undefined && renamed !== "" && renamed !== name) {
    entry.set("name", renamed);
  }
  if (patch.model !== undefined && patch.model.trim() !== "") {
    entry.set("model", patch.model.trim());
  }
  if (patch.provider !== undefined && patch.provider.trim() !== "") {
    entry.set("provider", patch.provider.trim());
  }
  if (patch.apiKey !== undefined && patch.apiKey.trim() !== "") {
    entry.set("apiKey", patch.apiKey.trim());
  }
  if (patch.apiBase !== undefined) {
    if (patch.apiBase && patch.apiBase.trim() !== "") {
      entry.set("apiBase", patch.apiBase.trim());
    } else {
      entry.delete("apiBase");
    }
  }
  if (patch.roles !== undefined && Array.isArray(patch.roles)) {
    entry.set(
      "roles",
      patch.roles.filter((role) => EDITABLE_ROLES.has(role)),
    );
  }
  if (patch.contextLength !== undefined) {
    if (patch.contextLength && patch.contextLength > 0) {
      entry.set("contextLength", patch.contextLength);
    } else {
      entry.delete("contextLength");
    }
  }
}
