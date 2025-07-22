import { AssistantUnrolled } from "@tnt/config-yaml";
import fetch, { Response } from "node-fetch";
import OpenAI from "openai";

/**
 * Interface for OpenAI client options with assistant models
 */
interface OpenAIClientOptions extends Record<string, any> {
  /**
   * Models from the assistant configuration
   */
  models: AssistantUnrolled["models"];

  /**
   * Optional organization ID
   */
  organizationId?: string | null;

  /**
   * Whether to always route model requests through a managed proxy
   */
  alwaysUseProxy?: boolean;

  /**
   * API key for the model proxy
   */
  apiKey?: string;

  /**
   * Base URL for the API
   */
  baseURL?: string;
}

/**
 * Create and configure an OpenAI client pointed at a model proxy
 *
 * @param options - OpenAI client options with assistant models
 * @returns Configured OpenAI client
 */
export function createOpenAIClient({
  models: assistantModels,
  apiKey,
  baseURL = "http://localhost:3001/",
}: OpenAIClientOptions): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: new URL("model-proxy/v1/", baseURL).toString(),
    fetch: async (url, init) => {
      const modifiedInit = init ? { ...init } : {};

      if (init?.method === "POST" && init?.body) {
        try {
          const body = JSON.parse(init.body as string);
          const modelName = body.model;

          const modelConfig = assistantModels?.find(
            (m) => m?.model === modelName || m?.model.endsWith(modelName),
          );

          if (!modelConfig) {
            throw new Error(
              `Model ${modelName} not found in assistant configuration`,
            );
          }
        } catch (e) {
          // If parsing fails, proceed with the original body
        }
      }

      // Using node-fetch explicitly, otherwise `fetch` has shadowing issues
      const response = await fetch(url.toString(), modifiedInit as any);

      return response as unknown as Response;
    },
  });
}
