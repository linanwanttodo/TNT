import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import { getLspManager } from "../../../lsp/manager.js";
import { serviceContainer } from "../../../services/ServiceContainer.js";
import { MCPServiceState, SERVICE_NAMES } from "../../../services/types.js";
import type { SlashCommandResult } from "../types.js";

import { handleDiagnostics } from "./diagnostics.js";

/**
 * The default port of JetBrains' built-in MCP Server plugin; a second IDE
 * instance shifts by one.
 */
const JETBRAINS_MCP_PORTS = [64342, 64343];
const JETBRAINS_SERVER_NAME = "jetbrains-ide";

/**
 * `/ide` - the JetBrains IDE integration surface, honest about what each channel can
 * and cannot do today:
 *
 *   /ide                        environment detection + channel status
 *   /ide connect jetbrains      bridge any JetBrains IDE's built-in MCP Server
 *   /ide tools <server>         list the tools a bridged IDE exposes
 *   /ide diagnostics <file>     LSP diagnostics for one file
 *
 * Static errors: TNT's own LSP stack (plugin-declared language servers) and
 * a bridged JetBrains MCP server that exposes IDE inspections. Dynamic
 * errors: run the app through Bash/background jobs (/jobs); the transcript
 * captures stderr where the agent can read it.
 */
export async function handleIdeCommand(
  args: string[] = [],
): Promise<SlashCommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      // Plain /ide: bridge JetBrains' MCP Server the moment it is reachable
      // and report the other channels. No ceremony.
      return autoConnect();
    case "connect":
      if (rest[0] === "jetbrains") {
        return connectJetBrains(rest[1] ? Number(rest[1]) : undefined);
      }
      return {
        output: t("ide.unknownConnectTarget", { target: rest[0] ?? "" }),
      };
    case "tools":
      return listServerTools(rest[0] ?? JETBRAINS_SERVER_NAME);
    case "diagnostics":
      return handleDiagnostics(rest);
    default:
      return { output: t("ide.unknownSubcommand", { sub: sub ?? "" }) };
  }
}

async function autoConnect(): Promise<SlashCommandResult> {
  const lines: string[] = [t("ide.statusHeader"), ""];

  // Which IDE owns the terminal this CLI runs in.
  const terminal = detectTerminal();
  lines.push(
    terminal === null
      ? chalk.dim(`  ${t("ide.terminalUnknown")}`)
      : `  ${chalk.cyan(terminal.label)}${terminal.note ? chalk.dim(` — ${terminal.note}`) : ""}`,
  );

  // JetBrains MCP: probe, then bridge immediately when reachable.
  const jetbrains = await probeJetBrainsMcp();
  if (jetbrains === null) {
    lines.push(
      `  ${chalk.dim(t("ide.jetbrainsMcp"))} ${chalk.dim(t("ide.channelDown"))}`,
    );
    lines.push(chalk.dim(`    ${t("ide.jetbrainsPluginHint")}`));
  } else {
    const bridged = await connectJetBrains(
      Number(jetbrains.match(/:(\d+)\//)?.[1] ?? undefined),
    );
    lines.push(
      ...(bridged.output ?? "").split("\n").map((line) => `  ${line}`),
    );
  }

  // Static errors: TNT's LSP stack, fed by installed plugins — the
  // marketplace can carry language-server plugins.
  const manager = getLspManager();
  const servers = await manager.ensureStarted(process.cwd());
  lines.push(
    servers > 0
      ? `  ${chalk.cyan(t("ide.lspChannel"))} ${chalk.green(t("ide.serversRunning", { count: servers }))}`
      : `  ${chalk.dim(t("ide.lspChannel"))} ${chalk.dim(t("ide.lspNone"))}`,
  );

  lines.push("", chalk.dim(t("ide.dynamicHint")));
  lines.push(chalk.dim(t("ide.vscodeNote")));
  return { output: lines.join("\n") };
}

interface DetectedTerminal {
  label: string;
  note?: string;
}

function detectTerminal(): DetectedTerminal | null {
  if (process.env.TERM_PROGRAM === "vscode") {
    return { label: "VS Code (integrated terminal)" };
  }
  if (process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm") {
    return { label: "JetBrains IDE (integrated terminal)" };
  }
  if (process.env.CLAUDE_CODE_SSE_PORT) {
    return {
      label: "Claude Code extension terminal",
      note: "another agent owns that channel",
    };
  }
  return null;
}

/** Probe the default JetBrains MCP ports; returns the reachable URL. */
async function probeJetBrainsMcp(): Promise<string | null> {
  for (const port of JETBRAINS_MCP_PORTS) {
    const url = `http://localhost:${port}/mcp`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      // Any HTTP answer proves an MCP endpoint lives on the port; the MCP
      // handshake itself happens through MCPService on connect.
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "ping",
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      void response.body?.cancel();
      if (response.status < 500) return url;
    } catch {
      // Port closed: try the next one.
    }
  }
  return null;
}

async function connectJetBrains(
  port: number | undefined,
): Promise<SlashCommandResult> {
  const state = await serviceContainer.get<MCPServiceState>(SERVICE_NAMES.MCP);
  const service = state.mcpService;
  if (!service) {
    return { output: t("ide.mcpUnavailable") };
  }

  const ports = port === undefined ? JETBRAINS_MCP_PORTS : [port];
  for (const candidate of ports) {
    const url = `http://localhost:${candidate}/mcp`;
    try {
      await service.addServer({
        name: JETBRAINS_SERVER_NAME,
        url,
      } as Parameters<typeof service.addServer>[0]);
      const tools = await listToolNames(JETBRAINS_SERVER_NAME);
      const lines = [
        chalk.green(`${t("ide.connected")} ${url}`),
        chalk.dim(t("ide.toolsHint", { count: tools.length })),
      ];
      for (const tool of tools) {
        const marker = /error|problem|diagnostic/i.test(tool)
          ? chalk.yellow(`  ★ ${tool}`)
          : chalk.dim(`  · ${tool}`);
        lines.push(marker);
      }
      lines.push("", chalk.dim(t("ide.toolsErrorsNote")));
      return { output: lines.join("\n") };
    } catch (error) {
      if (candidate === ports[ports.length - 1]!) {
        return {
          output: `${t("ide.connectFailed", { url })}: ${
            error instanceof Error ? error.message : String(error as unknown)
          }`,
        };
      }
    }
  }
  return { output: t("ide.connectFailed", { url: "jetbrains" }) };
}

async function listToolNames(serverName: string): Promise<string[]> {
  const state = await serviceContainer.get<MCPServiceState>(SERVICE_NAMES.MCP);
  const connection = state.connections.find(
    (entry) => entry.config.name === serverName,
  );
  return (connection?.tools ?? []).map((tool) => tool.name);
}

async function listServerTools(
  serverName: string,
): Promise<SlashCommandResult> {
  const state = await serviceContainer.get<MCPServiceState>(SERVICE_NAMES.MCP);
  const connection = state.connections.find(
    (entry) => entry.config.name === serverName,
  );
  if (!connection) {
    return { output: t("ide.serverNotConnected", { server: serverName }) };
  }
  if (connection.tools.length === 0) {
    return { output: t("ide.serverNoTools", { server: serverName }) };
  }
  const lines = connection.tools.map((tool) => {
    const marker = /error|problem|diagnostic/i.test(tool.name)
      ? chalk.yellow(`★ ${tool.name}`)
      : `· ${tool.name}`;
    return `  ${marker}${tool.description ? chalk.dim(` — ${tool.description}`) : ""}`;
  });
  return {
    output: [t("ide.toolsHeader", { server: serverName }), ...lines].join("\n"),
  };
}
