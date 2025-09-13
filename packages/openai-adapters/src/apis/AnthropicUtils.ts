import {
  Base64ImageSource,
  ErrorResponse,
  MessageParam,
  Tool,
  ToolChoice,
} from "@anthropic-ai/sdk/resources";
import {
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources";
import type { CacheControlFormat } from "./cacheControl.js";

export function getAnthropicErrorMessage(response: ErrorResponse): string {
  switch (response.error.type) {
    case "api_error":
      return "An unexpected error has occurred internal to Anthropic's systems.";
    case "invalid_request_error":
      return "There was an issue with the format or content of your request.";
    case "authentication_error":
      return "There's an issue with your API key.";
    case "permission_error":
      return "Your API key does not have permission to use the specified resource.";
    case "not_found_error":
      return "The requested resource was not found.";
    case "rate_limit_error":
      return "Your account has hit a rate limit.";
    case "overloaded_error":
      return "Anthropic's API is temporarily overloaded. Please check their status page: https://status.anthropic.com/#past-incidents";
    case "timeout_error":
      return "Anthropic API timed out. Please check their status page: https://status.anthropic.com/#past-incidents";
    case "billing_error":
    default:
      return response.error.message;
  }
}

/**
 * Detects if the given API base URL is an Azure-hosted Anthropic endpoint.
 * Azure AI Foundry hosts Anthropic models but requires a different auth header.
 *
 * Supported Azure endpoint patterns:
 * - *.services.ai.azure.com (Azure AI Foundry)
 * - *.cognitiveservices.azure.com (Azure Cognitive Services)
 *
 * @param apiBase - The API base URL to check
 * @returns true if the endpoint is an Azure-hosted Anthropic endpoint
 */
export function isAzureAnthropicEndpoint(apiBase?: string): boolean {
  if (!apiBase) {
    return false;
  }

  try {
    const url = new URL(apiBase);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname.endsWith(".services.ai.azure.com") ||
      hostname.endsWith(".cognitiveservices.azure.com")
    );
  } catch {
    // Invalid URL - fall back to false
    return false;
  }
}

export function getAnthropicHeaders(
  apiKey: string,
  enableCaching: boolean,
  apiBase?: string,
  enableContextManagement?: boolean,
): Record<string, string> {
  const isAzure = isAzureAnthropicEndpoint(apiBase);

  // Warn if Azure endpoint is used with Anthropic-style key
  if (isAzure && apiKey.startsWith("sk-ant-")) {
    console.warn(
      "[Continue] Azure endpoint detected but API key appears to be a standard Anthropic key (sk-ant-*). " +
        "Azure endpoints require Azure API keys from your AI Foundry resource.",
    );
  }

  const authHeaderName =
    isAzure && apiBase?.toLowerCase().includes("cognitiveservices.azure.com")
      ? "api-key"
      : "x-api-key";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "anthropic-version": "2023-06-01",
    [authHeaderName]: apiKey,
  };

  // Beta features are advertised through a comma-separated list. Context
  // management is opt-in and only reaches the official endpoint.
  const betas: string[] = [];
  if (enableCaching) {
    betas.push("prompt-caching-2024-07-31");
  }
  if (enableContextManagement) {
    betas.push("context-management-2025-06-27");
  }
  if (betas.length > 0) {
    headers["anthropic-beta"] = betas.join(",");
  }
  return headers;
}

export function addCacheControlToLastTwoUserMessages(messages: MessageParam[]) {
  let userMessages = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      userMessages++;
      if (typeof msg.content === "string") {
        continue;
      }
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const part = msg.content[j];
        if (part.type === "text") {
          part.cache_control = { type: "ephemeral" };
          break;
        }
      }
      if (userMessages >= 2) {
        break;
      }
    }
  }
}

export function openAiToolChoiceToAnthropicToolChoice(
  toolChoice: ChatCompletionToolChoiceOption | undefined,
): ToolChoice | undefined {
  if (!toolChoice) {
    return undefined;
  }
  switch (toolChoice) {
    case "none":
      // "none" is handled by excluding tools
      return undefined;
    case "required":
      return {
        type: "any",
      };
    case "auto":
      return {
        type: "auto",
      };
    default:
      switch (toolChoice.type) {
        case "allowed_tools":
          // Filtering of tools is handled elsewhere
          return {
            type: toolChoice.allowed_tools.mode === "auto" ? "auto" : "any",
          };
        case "custom":
          return undefined; // TODO not supported yet
        case "function":
          return {
            type: "tool",
            name: toolChoice.function.name,
          };
      }
  }
}

export function openaiToolToAnthropicTool(tool: ChatCompletionTool): Tool {
  if (tool.type === "function" && "function" in tool) {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters as Tool.InputSchema, // TODO unsafe cast, may be differences between openai tool schema and anthropic tool schema,
    };
  } else {
    throw new Error(`Unsupported tool type in Anthropic: ${tool.type}`);
  }
}

// Extract media type from data URL (ex. "data:image/png;base64,..." -> "image/png")
export function getAnthropicMediaTypeFromDataUrl(
  dataUrl: string,
): Base64ImageSource["media_type"] {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  if (match) {
    switch (match[1]) {
      case "image/png":
      case "image/gif":
      case "image/webp":
        return match[1];
    }
  }
  return "image/jpeg";
}

/**
 * DeepSeek caches on its own: it discounts whatever prefix it recognises and
 * reads no `cache_control` of its own. Marking breakpoints at it therefore pays a
 * cache write for a marker nobody reads, and on its Anthropic-compatible endpoint
 * the extra field also changes the bytes the prefix is matched on. So an
 * Anthropic-shaped request heading for DeepSeek carries no breakpoints at all.
 */
export const DEEPSEEK_ACCEPTS_NO_BREAKPOINTS: CacheControlFormat = {
  acceptsCacheControlOnTools: false,
  acceptsCacheControlOnMessages: false,
  maxBreakpoints: 0,
};

export function isDeepSeekEndpoint(apiBase?: string, model?: string): boolean {
  return (
    (apiBase ?? "").toLowerCase().includes("api.deepseek.com") ||
    (model ?? "").toLowerCase().includes("deepseek")
  );
}
