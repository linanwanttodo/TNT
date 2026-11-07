import { vi } from "vitest";

export const getApiClient = vi.fn<(accessToken: string | null) => any>(
  () => null,
);
export const getLlmApi =
  vi.fn<
    (
      config: any,
      authConfig: any,
      modelConfig?: any,
      orgScopeId?: string,
    ) => [any, any]
  >();
export const getModel = vi.fn<(config: any, modelName: string) => any>();
export const createLlmApi = vi.fn<(model: any) => any>();
// The ollama window fill passes the model through in tests; the discovery
// itself is exercised by the suites that stub /api/show.
export const applyOllamaContextWindow = vi.fn(async (model: any) => model);
