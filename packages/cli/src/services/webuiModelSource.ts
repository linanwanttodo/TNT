import type { ConfigServiceState } from "./types.js";

import {
  initializeServices,
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

export async function readWebUiModelSource(): Promise<WebUiModelSource> {
  await initializeServices({ headless: true });
  const result = serviceContainer.getSync<ConfigServiceState>(
    SERVICE_NAMES.CONFIG,
  );
  const config = result.state === "ready" ? result.value?.config : null;
  const models = (config?.models ?? []).filter(
    (model): model is NonNullable<typeof model> =>
      typeof model?.name === "string" && model.name.length > 0,
  );
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
    selected:
      result.state === "ready" ? result.value?.selectedModel : undefined,
  };
}
