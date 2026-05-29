import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { decodeFQSN, getTemplateVariables } from "@tnt/config-yaml";

import { parseEnvNumber } from "../utils/truncateOutput.js";

/**
 * Check if an error is an authentication error that should trigger token refresh
 * 405 is technically "not allowed" but some servers like Sanity don't return the correct error
 * Since we're using mcp library there's a good chance 405 means auth issue and doesn't hurt to retry with auth
 */
export function isAuthError(error: unknown): boolean {
  return (
    (error instanceof SseError && error.code === 401) ||
    (error instanceof SseError && error.code === 405) ||
    (error instanceof StreamableHTTPError && error.code === 401) ||
    (error instanceof StreamableHTTPError && error.code === 405) ||
    (error instanceof Error && error.message.includes("401")) ||
    (error instanceof Error && error.message.includes("405")) ||
    (error instanceof Error && error.message.includes("Unauthorized"))
  );
}

/** The per-request budget every MCP SDK call is given: ten minutes by default. */
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 600_000;
/** How long a transient failure waits before its single retry. */
export const DEFAULT_MCP_RETRY_DELAY_MS = 500;

export function mcpCallTimeoutMs(): number {
  return parseEnvNumber(
    process.env.TNT_MCP_CALL_TIMEOUT_MS,
    DEFAULT_MCP_CALL_TIMEOUT_MS,
  );
}

export function mcpRetryDelayMs(): number {
  return parseEnvNumber(
    process.env.TNT_MCP_RETRY_DELAY_MS,
    DEFAULT_MCP_RETRY_DELAY_MS,
  );
}

/**
 * The SDK options every client call is given: a generous per-request timeout
 * (the SDK default of 60s cuts off long-running tools mid-flight) and a reset
 * on progress, so a server that keeps reporting work is not killed for it.
 */
export function mcpRequestOptions(): {
  timeout: number;
  resetTimeoutOnProgress: true;
} {
  return {
    timeout: mcpCallTimeoutMs(),
    resetTimeoutOnProgress: true,
  };
}

/** HTTP statuses a repeat of the same call can plausibly survive. */
function isTransientStatusCode(code: number): boolean {
  // 408 request timeout and 429 too many requests are the classic retry-mes;
  // server-side 5xx is too, except 501 Not Implemented, which is the server
  // saying the request shape will never work.
  return code === 408 || code === 429 || (code >= 500 && code !== 501);
}

const TRANSIENT_NETWORK_PATTERN =
  /\b(?:ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|timed?\s*out|temporar(?:y|ily)\s+unavailable/i;

function hasTransientText(error: unknown, depth = 0): boolean {
  if (depth > 2 || !error || typeof error !== "object") {
    return false;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && TRANSIENT_NETWORK_PATTERN.test(message)) {
    return true;
  }
  return hasTransientText((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Whether an MCP call failed in a way that a single retry can fix: an HTTP
 * status the server itself calls transient (408, 429, 5xx but not 501), a
 * socket-level reset, or a timeout. Auth failures and protocol errors are
 * deliberately not transient - repeating them only doubles the noise.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof SseError || error instanceof StreamableHTTPError) {
    return typeof error.code === "number" && isTransientStatusCode(error.code);
  }
  return hasTransientText(error);
}

/**
 * Secret names a server config references but the environment did not fill.
 * A headless run fails on these; a TUI surfaces them as connection warnings.
 */
export function unresolvedSecretNames(serverConfig: object): string[] {
  const vars = getTemplateVariables(JSON.stringify(serverConfig));
  return vars
    .filter((v) => v.startsWith("secrets."))
    .map((v) => decodeFQSN(v.replace("secrets.", "")).secretName);
}

/** What to tell the user about those names, in both surfaces' wording. */
export function unresolvedSecretsMessage(
  serverName: string,
  secretNames: string[],
): string {
  return `${serverName} MCP Server has unresolved secrets: ${secretNames.join(", ")}
For personal use you can set the secret as an environment variable (e.g. in your shell profile or .tnt config) or pass it directly to the CLI environment.
TNT stores secrets locally and does not use an external hub.`;
}

/**
 * The warning a config with unfilled secrets deserves, or null when every
 * reference resolved - the one call a connect path needs to make.
 */
export function unresolvedSecretsWarning(serverConfig: {
  name: string;
}): string | null {
  const names = unresolvedSecretNames(serverConfig);
  if (names.length === 0) return null;
  return unresolvedSecretsMessage(serverConfig.name, names);
}
