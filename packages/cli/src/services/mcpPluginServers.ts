import { t } from "../i18n/index.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { logger } from "../utils/logger.js";

import type { MCPServerConfig } from "./types.js";

/**
 * MCP servers declared by installed plugins. Names are namespaced with the
 * plugin name so two plugins never collide on a server id.
 */
export function getPluginMcpServers(): MCPServerConfig[] {
  try {
    return Object.entries(loadAllPlugins().mcpServers).map(
      ([name, config]) =>
        ({
          name,
          ...(config as object),
        }) as MCPServerConfig,
    );
  } catch (error) {
    logger.warn("Failed to load plugin MCP servers:", error);
    return [];
  }
}

let warnedLegacyMcpConfig = false;

/** The legacy-config notice is a one-time warning, not a per-connect one. */
export function warnLegacyMcpConfigOnce(): void {
  if (warnedLegacyMcpConfig) return;
  warnedLegacyMcpConfig = true;
  console.warn(t("mcp.legacyConfigServers"));
}
