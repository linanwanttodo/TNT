import { t } from "../../../i18n/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * `/mcp` is a parent: entering it lists the configured servers, and `market`
 * opens the catalog. Anything that is not a known child keeps the historical
 * behavior (open the list), so `/mcp` alone stays useful.
 */
export async function handleMcp(
  args: string[] = [],
): Promise<SlashCommandResult> {
  const sub = (args[0] ?? "").trim().toLowerCase();
  if (sub === "market") {
    return { openMcpMarketplace: true };
  }
  return { openMcpSelector: true };
}

export const MCP_SUBCOMMANDS = [
  { name: "list", description: t("mcp.sub.list") },
  { name: "market", description: t("mcp.sub.market") },
];
