import * as fs from "fs";
import { dirname } from "node:path";
import * as path from "path";

import {
  AssistantUnrolled,
  PackageIdentifier,
  RegistryClient,
  unrollAssistant,
  unrollAssistantFromContent,
} from "@tnt/config-yaml";
import { DefaultApiInterface } from "@tnt/sdk/dist/api/dist/index.js";
import chalk from "chalk";

import { t } from "../i18n/index.js";
import { CLIPlatformClient } from "../platform/CLIPlatformClient.js";

import { env } from "./env.js";
import { readSelectedModelName } from "./modelSelection.js";

export interface ConfigLoadResult {
  config: AssistantUnrolled;
  source: ConfigSource;
  selectedModel?: string | null;
}

export type ConfigSource =
  | { type: "cli-flag"; path: string }
  | { type: "local-config-yaml" }
  | { type: "no-config" };

/**
 * Streamlined configuration loader that implements the specification
 * with clear precedence and fallback logic in a single testable function.
 */
export async function loadConfiguration(
  cliConfigPath: string | undefined,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
  isHeadless: boolean | undefined,
): Promise<ConfigLoadResult> {
  // The unroll API in @tnt/config-yaml still accepts an account's token and
  // organization; there is no account to take them from, so they stay null here.
  const organizationId: string | null = null;
  const accessToken: string | null = null;

  // Step 1: Determine config source using precedence rules
  const configSource = determineConfigSource(cliConfigPath, isHeadless);

  // Step 2: Load configuration from the determined source
  const config = await loadFromSource(
    configSource,
    accessToken,
    organizationId ?? null,
    apiClient,
    injectBlocks,
  );

  return {
    config,
    source: configSource,
    selectedModel: selectedModelOf(configSource),
  };
}

/**
 * The selected model is the `model:` key of the file that was loaded. A config
 * assembled from injected blocks has no file, so it has no selection either.
 */
function selectedModelOf(source: ConfigSource): string | null {
  if (source.type === "cli-flag") return readSelectedModelName(source.path);
  if (source.type === "local-config-yaml") return readSelectedModelName();
  return null;
}

/**
 * Determines the configuration source using the specification's precedence rules:
 * 1. CLI --config flag (highest priority)
 * 2. Saved config URI (if no CLI flag)
 * 3. Default resolution (if no flag and no saved URI)
 */
function determineConfigSource(
  cliConfigPath: string | undefined,
  _isHeadless: boolean | undefined,
): ConfigSource {
  // Priority 1: CLI --config flag
  if (cliConfigPath) {
    return { type: "cli-flag", path: cliConfigPath };
  }

  // Priority 2: the local config.yaml the interactive setup writes
  const defaultConfigPath = path.join(env.continueHome, "config.yaml");
  if (fs.existsSync(defaultConfigPath)) {
    return { type: "local-config-yaml" };
  }
  return { type: "no-config" };
}

/**
 * Loads configuration from the determined source with appropriate error handling
 */
async function loadFromSource(
  source: ConfigSource,
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
): Promise<AssistantUnrolled> {
  try {
    switch (source.type) {
      case "cli-flag":
        return await loadFromCliFlag(
          source.path,
          accessToken,
          organizationId,
          apiClient,
          injectBlocks,
        );

      case "local-config-yaml":
        return await loadLocalConfigYaml(
          accessToken,
          organizationId,
          apiClient,
          injectBlocks,
        );

      case "no-config":
        // Nothing is fetched over the network. A machine with no config starts
        // the interactive setup, which writes one locally; embedders and tests
        // that skip onboarding get the injected blocks alone.
        return await unrollPackageIdentifiersAsConfigYaml(
          injectBlocks,
          accessToken,
          organizationId,
          apiClient,
        );
      default:
        throw new Error(
          t("config.unknownConfigSourceType", { type: (source as any).type }),
        );
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Loads configuration from CLI --config flag
 * Supports both file paths and assistant slugs
 */
async function loadFromCliFlag(
  configPath: string,
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
): Promise<AssistantUnrolled> {
  if (isFilePath(configPath)) {
    // Load local YAML file
    return await loadConfigYaml(
      configPath,
      accessToken,
      organizationId,
      apiClient,
      injectBlocks,
    );
  }

  throw new Error(t("config.slugRemoved"));
}

/**
 * Loads default config.yaml from ~/.tnt/config.yaml
 */
async function loadLocalConfigYaml(
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
): Promise<AssistantUnrolled> {
  const defaultConfigPath = path.join(env.continueHome, "config.yaml");
  return await loadConfigYaml(
    defaultConfigPath,
    accessToken,
    organizationId,
    apiClient,
    injectBlocks,
  );
}

export async function unrollPackageIdentifiersAsConfigYaml(
  packageIdentifiers: PackageIdentifier[],
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
): Promise<AssistantUnrolled> {
  const unrollResult = await unrollAssistantFromContent(
    {
      uriType: "file",
      fileUri: "",
    },
    "name: Agent\nschema: v1\nversion: 0.0.1",
    new RegistryClient({
      rootPath: undefined, // TODO verify this doesn't cause issues with file blocks
    }),
    {
      currentUserSlug: "",
      platformClient: new CLIPlatformClient(organizationId, apiClient),
      renderSecrets: true,
      injectBlocks: packageIdentifiers,
    },
  );
  if (unrollResult.errors) {
    const fatalError = unrollResult.errors?.find((e) => e.fatal);
    if (fatalError) {
      throw new Error(
        t("config.failedToLoadConfigWithReason", {
          reason: fatalError.message,
        }),
      );
    }
  }
  if (!unrollResult?.config) {
    throw new Error(t("config.failedToLoadConfig"));
  }

  return unrollResult.config;
}

async function unrollAssistantWithConfig(
  packageIdentifier: PackageIdentifier,
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
): Promise<AssistantUnrolled> {
  const unrollResult = await unrollAssistant(
    packageIdentifier,
    new RegistryClient({
      rootPath:
        packageIdentifier.uriType === "file"
          ? dirname(packageIdentifier.fileUri)
          : undefined,
    }),
    {
      currentUserSlug: "",
      alwaysUseProxy: false,
      renderSecrets: true,
      platformClient: new CLIPlatformClient(organizationId, apiClient),
      injectBlocks,
    },
  );

  const errorDetails = unrollResult.errors;
  if (!unrollResult.config) {
    throw new Error(
      t("config.failedToLoadConfigDetails", { details: String(errorDetails) }),
    );
  } else if (errorDetails?.length) {
    const warnings =
      errorDetails?.length > 1
        ? errorDetails.map((d) => `\n- ${d.message}`)
        : errorDetails[0].message;
    console.warn(
      chalk.dim(t("common.warningDetail", { detail: String(warnings) })),
    );
  }

  return unrollResult.config;
}

/**
 * Loads a local YAML configuration file
 */
async function loadConfigYaml(
  filePath: string,
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
): Promise<AssistantUnrolled> {
  return await unrollAssistantWithConfig(
    { fileUri: filePath, uriType: "file" },
    accessToken,
    organizationId,
    apiClient,
    injectBlocks,
  );
}

/**
 * Determines if a config path is a file path vs assistant slug
 */
function isFilePath(configPath: string): boolean {
  return (
    configPath.startsWith(".") ||
    configPath.startsWith("/") ||
    configPath.startsWith("~") ||
    // Windows absolute paths (C:\, D:\, etc.)
    /^[A-Za-z]:[/\\]/.test(configPath) ||
    // UNC paths (\\server\share)
    configPath.startsWith("\\\\") ||
    // Contains file extension
    configPath.includes(".yaml") ||
    configPath.includes(".yml") ||
    configPath.includes(".json")
  );
}
