import { sortToolsByName } from "../stableOrder.js";
import type { Tool } from "../types.js";

/**
 * What the request advertises, as distinct from what each tool does.
 *
 * MCP servers are the one part of the tool surface this package does not own.
 * A handful of them can put far more schema text into every request than all of
 * the built-in tools combined, and that text is re-billed on every turn whether
 * or not the model touches it.
 *
 * Past a measured share of the context window, the request keeps the connected
 * tools out of its definitions and offers the catalog tool instead. Names and
 * schemas stay reachable through that catalog, and a hidden tool can be called
 * directly once the model knows its name: execution resolves against every
 * available tool, not against the list that was advertised.
 */

export const TOOL_SEARCH_NAME = "ToolSearch";

const MCP_NAME_PREFIX = "mcp__";

/**
 * Anthropic's client and API activate tool search when the deferrable
 * definitions would take a tenth of the context window; below that, loading
 * everything upfront is faster and costs less attention than a search round
 * trip. The share is the trigger here too, so the decision moves with the
 * model's window instead of with a fixed tool count that means different
 * things on a 32k and a 1M-token model.
 */
const DEFERRAL_CONTEXT_SHARE = 0.1;
const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** The floor keeps a tiny window from deferring on a few hundred tokens. */
const MIN_DEFERRED_TOKENS = 1_000;

export interface DeferralOptions {
  /** The model's context window, when the caller knows it. */
  contextWindow?: number;
}

export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_NAME_PREFIX);
}

function schemaCharacters(tool: Tool): number {
  return (
    tool.name.length +
    tool.description.length +
    JSON.stringify(tool.parameters).length
  );
}

export function estimateSchemaTokens(tools: readonly Tool[]): number {
  return Math.ceil(
    tools.reduce((total, tool) => total + schemaCharacters(tool), 0) /
      APPROX_CHARS_PER_TOKEN,
  );
}

/**
 * Whether this request should trade inline MCP schemas for the catalog tool.
 *
 * `CONTINUE_CLI_DEFER_MCP_TOOLS=1` forces it on and `=0` forces it off; the
 * default is `auto`, which decides from the share of the context window the
 * hidden definitions would occupy.
 */
export function shouldDeferMcpTools(
  tools: readonly Tool[],
  options: DeferralOptions = {},
): boolean {
  const override = (process.env.CONTINUE_CLI_DEFER_MCP_TOOLS ?? "")
    .trim()
    .toLowerCase();
  if (override === "0" || override === "false" || override === "off") {
    return false;
  }

  const mcpTools = tools.filter((tool) => isMcpTool(tool.name));
  if (mcpTools.length === 0) {
    return false;
  }
  if (override === "1" || override === "true" || override === "on") {
    return true;
  }

  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const shareTokens = Math.max(
    MIN_DEFERRED_TOKENS,
    Math.floor(contextWindow * DEFERRAL_CONTEXT_SHARE),
  );
  return estimateSchemaTokens(mcpTools) >= shareTokens;
}

/**
 * The tools a request should advertise. The catalog tool itself is only
 * advertised while it has something to hide, so a session with no MCP servers
 * pays neither the schemas nor the catalog entry. A catalog the permission
 * table withheld also cancels the trade: hiding tools with no way to discover
 * them removes a capability instead of saving tokens.
 */
export function selectRequestTools(
  tools: readonly Tool[],
  options: DeferralOptions = {},
): Tool[] {
  const catalog = tools.find((tool) => tool.name === TOOL_SEARCH_NAME);
  const withoutCatalog = tools.filter((tool) => tool.name !== TOOL_SEARCH_NAME);

  if (!catalog || !shouldDeferMcpTools(withoutCatalog, options)) {
    return sortToolsByName(withoutCatalog);
  }

  return sortToolsByName([
    ...withoutCatalog.filter((tool) => !isMcpTool(tool.name)),
    catalog,
  ]);
}
