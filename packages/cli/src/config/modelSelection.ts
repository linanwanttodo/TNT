import fs from "fs";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";
import { setConfigFilePermissions } from "core/util/paths.js";
import YAML from "yaml";

import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";

import { env } from "./env.js";

/**
 * Model definitions and the selection live in one file. The CLI reads `model:`
 * from the config it loaded and writes it back when the user switches, using
 * the YAML document model so comments and ordering survive the round trip.
 */
export function defaultConfigPath(): string {
  return path.join(env.continueHome, "config.yaml");
}

export function readSelectedModelName(
  file: string = defaultConfigPath(),
): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed: unknown = YAML.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const selected = (parsed as Record<string, unknown>).model;
    return typeof selected === "string" && selected.trim()
      ? selected.trim()
      : null;
  } catch (error) {
    logger.warn("Failed to read the selected model", { error, path: file });
    return null;
  }
}

export function writeSelectedModelName(
  modelName: string,
  file: string = defaultConfigPath(),
): void {
  if (!fs.existsSync(file)) {
    throw new Error(t("config.selectedModelFileMissing", { path: file }));
  }

  const doc = YAML.parseDocument(fs.readFileSync(file, "utf-8"));
  const models = doc.get("models");
  const declared = YAML.isSeq(models)
    ? models.items
        .map((model) => (YAML.isMap(model) ? model.get("name") : null))
        .filter((name): name is string => typeof name === "string")
    : [];
  if (!declared.includes(modelName)) {
    throw new Error(
      t("config.selectedModelUnknown", { model: modelName, path: file }),
    );
  }

  doc.set("model", modelName);
  writeFileAtomically(file, doc.toString());
  setConfigFilePermissions(file);
}
