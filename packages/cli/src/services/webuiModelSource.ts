import { logger } from "../utils/logger.js";

import type { ConfigServiceState } from "./types.js";

import {
  ensureServicesInitialized,
  serviceContainer,
  SERVICE_NAMES,
} from "./index.js";

/**
 * The model list the web shell renders. It lives in the services group so the
 * web UI host does not import the service registry back (that would close an
 * import cycle), and it is injected into the per-connection collection by
 * WebUiService.
 */
export interface WebUiModelSource {
  models: Array<{
    name: string;
    provider: string;
    model: string;
    apiBase?: string;
    contextLength?: number;
    maxOutputTokens?: number;
    useResponsesApi?: boolean;
    roles?: string[];
  }>;
  selected?: string | null;
}

/**
 * Reads the config the host process already loaded. It must not call
 * initializeServices again: `load` runs a factory even when the service is
 * ready, so a second pass re-ran ConfigService.initialize inside the live
 * serve process, which failed and left CONFIG in its error state - the shell
 * then saw no models at all. `get` returns a ready value as-is and only loads
 * a service that has not started yet.
 */
export async function readWebUiModelSource(): Promise<WebUiModelSource> {
  // The serve daemon starts without the registry; this is the first reader a
  // browser triggers. The shared lazy entry initializes once and a process
  // that already initialized (TUI, `tnt webui`) returns without re-running
  // the factories.
  await ensureServicesInitialized();
  let config: ConfigServiceState | null = null;
  try {
    config = await serviceContainer.get<ConfigServiceState>(
      SERVICE_NAMES.CONFIG,
    );
  } catch (error) {
    logger.debug("webui model source: config is unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const models = (config?.config?.models ?? []).filter(
    (model): model is NonNullable<typeof model> =>
      typeof model?.name === "string" && model.name.length > 0,
  );
  logger.debug("webui model source read", {
    configPath: config?.configPath,
    models: models.length,
  });
  return {
    models: models.map((model) => ({
      name: model.name,
      provider: model.provider,
      model: model.model,
      apiBase: model.apiBase,
      contextLength: model.contextLength,
      maxOutputTokens: model.defaultCompletionOptions?.maxTokens,
      useResponsesApi: model.useResponsesApi,
      roles: model.roles,
    })),
    selected: config?.selectedModel,
  };
}
