import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { decodeFQSN, getTemplateVariables } from "@tnt/config-yaml";
import { type AssistantConfig } from "@tnt/sdk";

import { loadMcpJsonServers } from "../config/mcpConfig.js";
import { t } from "../i18n/index.js";
import { loadAllPlugins } from "../plugins/loader.js";
import { getErrorString } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import { registerShutdownCallback } from "../utils/processShutdown.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import {
  IdleReclaimer,
  idleTimeoutMs,
  ReclaimableConnection,
} from "./mcpIdleReclaim.js";
import {
  constructHttpTransport,
  constructSseTransport,
  constructStdioTransport,
} from "./mcpTransports.js";
import { isAuthError } from "./mcpUtils.js";
import { serviceContainer } from "./ServiceContainer.js";
import {
  MCPConnectionInfo,
  MCPServerConfig,
  MCPServiceState,
  SERVICE_NAMES,
} from "./types.js";

interface ServerConnection extends MCPConnectionInfo, ReclaimableConnection {
  client: Client | null;
}

/**
 * MCP servers declared by installed plugins. Names are namespaced with the
 * plugin name so two plugins never collide on a server id.
 */
function getPluginMcpServers(): MCPServerConfig[] {
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

function warnLegacyMcpConfigOnce(): void {
  if (warnedLegacyMcpConfig) return;
  warnedLegacyMcpConfig = true;
  console.warn(t("mcp.legacyConfigServers"));
}

export const EMPTY_MCP_STATE: MCPServiceState = {
  mcpService: null,
  connections: [],
  tools: [],
  prompts: [],
};

export class MCPService
  extends BaseService<MCPServiceState>
  implements ServiceWithDependencies
{
  private connections: Map<string, ServerConnection> = new Map();
  private assistant: AssistantConfig | null = null;
  /** config.yaml + mcp.json + plugins, keyed by server name. */
  private configuredServers: MCPServerConfig[] = [];
  private isShuttingDown = false;
  private isHeadless: boolean | undefined;
  private apiKeyCache: Map<string, string> = new Map();
  private reclaimer = new IdleReclaimer<ServerConnection>(
    () => [...this.connections.values()],
    (connection) => {
      logger.debug("Reclaiming idle MCP server", {
        name: connection.config?.name,
        idleMs: idleTimeoutMs(),
      });
      // The tool list is kept: releasing the process must not silently take
      // capability away from a model that was already told about it.
      return this.shutdownConnection(connection, { keepTools: true });
    },
  );

  getDependencies(): string[] {
    return [SERVICE_NAMES.CONFIG, SERVICE_NAMES.AUTH];
  }
  constructor() {
    super("MCPService", {
      ...EMPTY_MCP_STATE,
    });

    // Registered under a key: constructing another instance replaces this
    // callback instead of stacking another set of process listeners.
    registerShutdownCallback("mcp-service", () => {
      void this.cleanup();
    });
  }

  /**
   * Initialize the MCP service
   */
  async doInitialize(
    assistant: AssistantConfig,
    hasAgentFile: boolean,
    isHeadless: boolean | undefined,
  ): Promise<MCPServiceState> {
    this.isHeadless = isHeadless;

    await this.shutdownConnections();

    this.assistant = assistant;
    this.connections.clear();

    const pluginServers = getPluginMcpServers();
    const legacyServers = (assistant.mcpServers ?? []).filter(
      (server): server is NonNullable<typeof server> => Boolean(server),
    );
    if (legacyServers.length > 0) {
      warnLegacyMcpConfigOnce();
    }

    // Later sources win per server name: config.yaml is the transitional
    // source, mcp.json is the current one, plugins are namespaced already.
    const byName = new Map<string, MCPServerConfig>();
    [...legacyServers, ...loadMcpJsonServers()].forEach((server, index) => {
      const name = server.name || `server-${index}`;
      byName.set(name, { ...server, name } as MCPServerConfig);
    });
    for (const server of pluginServers) byName.set(server.name, server);

    const allServers = [...byName.values()];
    this.configuredServers = allServers;

    const connectionPromises = allServers.map(async (config) => {
      if (config) {
        return await this.connectServer(config);
      }
    });

    const connectionInit = Promise.all(connectionPromises ?? []);
    if (isHeadless || hasAgentFile) {
      await connectionInit;

      if (isHeadless) {
        // With headless or agent, throw error if any MCP server failed to connect
        const failedConnections = Array.from(this.connections.values()).filter(
          (c) => c.status === "error",
        );
        if (failedConnections.length > 0) {
          const errorMessages = failedConnections.map(
            (c) => `${c.config?.name}: ${c.error}`,
          );
          throw new Error(
            t("mcp.serversFailedToLoad", {
              errors: errorMessages.join("\n"),
            }),
          );
        }
      }
    } else {
      this.updateState();
    }

    return this.currentState;
  }

  /**
   * Add one server after initialization. ACP sessions own their worker, so the
   * per-session server set can be connected at session creation without
   * re-reading the process-wide config.
   */
  public async addServer(serverConfig: MCPServerConfig): Promise<void> {
    if (!serverConfig?.name || this.connections.has(serverConfig.name)) {
      return;
    }
    this.configuredServers = [
      ...this.configuredServers.filter(
        (server) => server.name !== serverConfig.name,
      ),
      serverConfig,
    ];
    await this.connectServer(serverConfig);
    this.updateState();
  }

  /**
   * Update internal state based on current connections
   */
  private updateState() {
    const connections: MCPConnectionInfo[] = Array.from(
      this.connections.values(),
    ).map(({ client: _, ...rest }) => rest);
    // A reclaimed server is not connected but is still known: its tool list is
    // kept precisely so the model can see and select it, and the next call
    // reconnects. Dropping the list with the process would turn saving memory
    // into silently losing capabilities, which is the worse trade.
    const listed = connections.filter(
      (c) => c.status === "connected" || c.tools.length > 0,
    );
    const tools = listed.flatMap((s) => s.tools);
    const prompts = listed.flatMap((s) => s.prompts);

    const newState: MCPServiceState = {
      mcpService: this,
      connections,
      tools,
      prompts,
    };
    this.setState(newState);
    serviceContainer.set(SERVICE_NAMES.MCP, newState);
  }

  /**
   * Get current MCP service state
   */
  getState(): MCPServiceState {
    return { ...this.currentState };
  }

  /**
   * Get overall status for UI indicator
   */
  getOverallStatus(): {
    status: "idle" | "connecting" | "connected" | "error";
    hasWarnings: boolean;
  } {
    const connections = Array.from(this.connections.values());
    const hasWarnings = connections.some((c) => c.warnings.length > 0);

    if (connections.some((c) => c.status === "connecting")) {
      return { status: "connecting", hasWarnings };
    }
    if (connections.some((c) => c.status === "error")) {
      return { status: "error", hasWarnings };
    }
    if (connections.some((c) => c.status === "connected")) {
      return { status: "connected", hasWarnings };
    }

    return { status: "idle", hasWarnings };
  }

  /**
   * Generic wrapper for client operations that handles 401 errors with token refresh
   * Only applies to SSE/HTTP connections, not stdio
   */
  private async withTokenRefresh<T>(
    serverName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`Connection ${serverName} not found`);
    }

    const serverConfig = connection.config;
    if (!serverConfig || "command" in serverConfig) {
      // For stdio connections, just execute normally (no token refresh possible)
      return await operation();
    }

    // No auth/token refresh available - just execute the operation directly
    return await operation();
  }

  /**
   * Run a tool by name. The server that owns it is passed when the caller knows
   * it, which is the only way two servers exporting the same tool name can both
   * be reached: scanning for the first name match would always answer with the
   * first server and leave the other one unreachable.
   */
  public async runTool(
    name: string,
    args: Record<string, any>,
    serverName?: string,
  ) {
    for (const connection of this.connections.values()) {
      const owner = connection.config?.name;
      if (!owner) continue;
      if (serverName && owner !== serverName) continue;

      const tool = connection.tools.find((t) => t.name === name);
      if (!tool) continue;
      // Still coming up from the startup connect: not this call's problem, and
      // reconnecting a connecting server would only double-spawn it.
      if (connection.status === "connecting") continue;

      if (connection.status !== "connected" || !connection.client) {
        // Reclaimed by the idle sweep, or never reached: bring it back rather
        // than advertising a tool and then failing on it.
        await this.connectServer(connection.config);
      }

      const live = this.connections.get(owner);
      if (live) {
        live.inFlight += 1;
        live.lastUsedAt = Date.now();
      }
      try {
        return await this.withTokenRefresh(owner, async () => {
          const conn = this.connections.get(owner);
          if (!conn?.client) {
            throw new Error(`Client for ${owner} not available`);
          }
          return await conn.client.callTool({
            name,
            arguments: args,
          });
        });
      } finally {
        const done = this.connections.get(owner);
        if (done) {
          done.inFlight = Math.max(0, done.inFlight - 1);
        }
      }
    }
    throw new Error(
      serverName
        ? t("mcp.toolNotFoundOnServer", { name, server: serverName })
        : t("mcp.toolNotFound", { name }),
    );
  }

  /**
   * Restart all servers
   */
  public async restartAllServers(): Promise<void> {
    if (!this.assistant) return;

    await this.shutdownConnections();
    await this.initialize(this.assistant);
  }

  /**
   * Restart a specific server
   */
  public async restartServer(serverName: string): Promise<void> {
    if (!this.assistant) return;

    const serverConfig = this.configuredServers.find(
      (s) => s.name === serverName,
    );

    if (!serverConfig) {
      throw new Error(t("mcp.serverNotConfigured", { server: serverName }));
    }

    const existingConnection = this.connections.get(serverName);
    if (existingConnection) {
      if (existingConnection.status === "connected") {
        await this.shutdownConnection(existingConnection);
      }
      this.connections.delete(serverName);
    }
    await this.connectServer(serverConfig);
  }

  private async connectServer(serverConfig: MCPServerConfig) {
    const connection: ServerConnection = {
      config: serverConfig,
      client: null,
      prompts: [],
      tools: [],
      status: "connecting",
      warnings: [],
      lastUsedAt: Date.now(),
      inFlight: 0,
    };
    const serverName = serverConfig.name;
    this.connections.set(serverName, connection);
    this.updateState();

    const vars = getTemplateVariables(JSON.stringify(serverConfig));
    const secretVars = vars.filter((v) => v.startsWith("secrets."));
    const unrendered = secretVars.map((v) => {
      return decodeFQSN(v.replace("secrets.", "")).secretName;
    });

    try {
      if (unrendered.length > 0) {
        const message = `${serverConfig.name} MCP Server has unresolved secrets: ${unrendered.join(", ")}
For personal use you can set the secret as an environment variable (e.g. in your shell profile or .tnt config) or pass it directly to the CLI environment.
TNT stores secrets locally and does not use an external hub.`;
        if (this.isHeadless) {
          throw new Error(message);
        } else {
          connection.warnings.push(message);
        }
      }

      const client = await this.getConnectedClient(serverConfig, connection);

      connection.client = client;
      connection.status = "connected";
      connection.lastUsedAt = Date.now();
      this.reclaimer.start();
      this.updateState();

      const capabilities = client.getServerCapabilities();

      if (capabilities?.prompts) {
        try {
          connection.prompts = await this.withTokenRefresh(
            serverName,
            async () => {
              const conn = this.connections.get(serverName);
              if (!conn?.client) {
                throw new Error(`Client for ${serverName} not available`);
              }
              return (await conn.client.listPrompts()).prompts;
            },
          );
        } catch (error) {
          const errorMessage = getErrorString(error);
          connection.warnings.push(`Failed to load prompts: ${errorMessage}`);
          logger.warn("Failed to load MCP prompts", {
            name: serverName,
            error: errorMessage,
          });
        }
      }

      if (capabilities?.tools) {
        try {
          connection.tools = await this.withTokenRefresh(
            serverName,
            async () => {
              const conn = this.connections.get(serverName);
              if (!conn?.client) {
                throw new Error(`Client for ${serverName} not available`);
              }
              return (await conn.client.listTools()).tools;
            },
          );
        } catch (error) {
          const errorMessage = getErrorString(error);
          connection.warnings.push(`Failed to load tools: ${errorMessage}`);
          logger.warn("Failed to load MCP tools", {
            name: serverName,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = getErrorString(error);
      connection.status = "error";

      // Convert any warnings to error at time of connection failure
      if (connection.warnings.length > 0) {
        const stderrContent = connection.warnings.join("\n");
        connection.error = `${errorMessage}\n\nServer stderr:\n${stderrContent}`;
        connection.warnings = [];
      } else {
        connection.error = errorMessage;
      }

      logger.error("Failed to connect to MCP server", {
        name: serverName,
        error: connection.error,
      });
    }

    this.updateState();
  }

  /**
   * Stop a specific server
   */
  public async stopServer(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (connection) {
      await this.shutdownConnection(connection);
    }
  }

  /**
   * Shutdown all connections
   */
  public async shutdownConnections(): Promise<void> {
    const shutdownPromises = Array.from(this.connections.values()).map(
      (connection) => this.shutdownConnection(connection),
    );
    this.reclaimer.stop();
    await Promise.all(shutdownPromises);
    this.updateState();
  }

  /**
   * Shutdown a single connection.
   *
   * `keepTools` is the reclaim path: the process and its socket go, the tool
   * list stays, so the catalog the model reads does not quietly shrink because
   * nobody called a server for five minutes.
   */
  private async shutdownConnection(
    connection: ServerConnection,
    options: { keepTools?: boolean } = {},
  ): Promise<void> {
    try {
      if (connection.client) {
        await connection.client.close();
      }
      connection.status = "idle";
      connection.warnings = [];
      connection.client = null;
      if (!options.keepTools) {
        connection.tools = [];
        connection.prompts = [];
      }
      connection.error = undefined;
      this.updateState();
    } catch (error) {
      const errorMessage = getErrorString(error);
      logger.warn("Error shutting down MCP connection", {
        name: connection.config?.name,
        error: errorMessage,
      });
    }
  }

  /**
   * Stops sweeping with the service: the timer is unref'd, but a teardown that
   * leaves it running would race the connections it just closed.
   */
  public async cleanup(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.removeAllListeners();
    this.reclaimer.stop();
    await this.shutdownConnections();
  }

  /**
   * Construct transport based on server configuration and connect client
   */
  private async getConnectedClient(
    serverConfig: MCPServerConfig,
    connection: ServerConnection,
  ): Promise<Client> {
    const client = new Client(
      { name: "tnt-cli-client", version: "1.0.0" },
      { capabilities: {} },
    );

    if ("command" in serverConfig) {
      // STDIO: no need to check type, just if command is present
      const transport = constructStdioTransport(serverConfig, connection);
      await client.connect(transport, {});
    } else {
      // SSE/HTTP: if type isn't explicit: try http and fall back to sse
      try {
        await this.withTokenRefresh(serverConfig.name, async () => {
          if (serverConfig.apiKey && !this.apiKeyCache.get(serverConfig.name)) {
            this.apiKeyCache.set(serverConfig.name, serverConfig.apiKey);
          }
          const apiKey = this.apiKeyCache.get(serverConfig.name);
          if (serverConfig.type === "sse") {
            const transport = constructSseTransport(serverConfig, apiKey);
            await client.connect(transport, {});
          } else if (serverConfig.type === "streamable-http") {
            const transport = constructHttpTransport(serverConfig, apiKey);
            await client.connect(transport, {});
          } else {
            try {
              const transport = constructHttpTransport(serverConfig, apiKey);
              await client.connect(transport, {});
            } catch (e) {
              if (isAuthError(e)) {
                throw e;
              }
              const transport = constructSseTransport(serverConfig, apiKey);
              await client.connect(transport, {});
            }
          }
        });
      } catch (error: unknown) {
        // If token refresh didn't work and it's a 401, fall back to mcp-remote
        if (isAuthError(error) && !this.isHeadless) {
          // Build mcp-remote args with Supabase-specific OAuth scopes if needed
          const mcpRemoteArgs = ["-y", "mcp-remote", serverConfig.url];

          // Detect Supabase MCP and add custom OAuth scopes
          if (serverConfig.url.includes("mcp.supabase.com")) {
            const supabaseScopes = [
              "organizations:read",
              "projects:read",
              "database:read",
              "analytics:read",
              "secrets:read",
              "edge_functions:read",
              "environment:read",
              "storage:read",
            ].join(" ");

            mcpRemoteArgs.push(
              "--static-oauth-client-metadata",
              JSON.stringify({ scope: supabaseScopes }),
            );
          }

          const transport = constructStdioTransport(
            {
              name: serverConfig.name,
              command: "npx",
              args: mcpRemoteArgs,
            },
            connection,
          );
          await client.connect(transport, {});
        } else {
          throw error;
        }
      }
    }

    return client;
  }
}
