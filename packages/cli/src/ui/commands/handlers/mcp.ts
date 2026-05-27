import { t } from "../../../i18n/index.js";
import { assertPublicHttpUrl } from "../../../utils/urlGuard.js";
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
  if (sub === "search") {
    return await handleMcpSearch(args.slice(1).join(" "));
  }
  if (sub === "install") {
    return await handleMcpInstall(args[1]);
  }
  return { openMcpSelector: true };
}

/**
 * The public MCP registry the reference client queries; the DXT payload is
 * fetched per entry on install. Both endpoints are plain https GETs.
 */
const MCP_REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";
const MCP_SERVER_URL = "https://registry.modelcontextprotocol.io/v0/servers/";

interface RegistryServer {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  packages?: Array<{
    registry_type?: string;
    identifier?: string;
    version?: string;
    transport?: string;
  }>;
  remotes?: Array<{ type?: string; url?: string }>;
}

interface ResolvedServer {
  name: string;
  title: string;
  description: string;
  /** stdio launch or a remote URL, resolved from the registry entry. */
  command?: string;
  args?: string[];
  url?: string;
  transport?: "sse" | "streamable-http";
}

function registryHeaders(): Record<string, string> {
  return { Accept: "application/json" };
}

async function fetchRegistryJson(url: string): Promise<unknown> {
  // The host is the public registry constant; the guard still pins the
  // protocol and the resolved addresses before anything goes out.
  const target = await assertPublicHttpUrl(url);
  const response = await fetch(target, {
    headers: registryHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

/**
 * Resolves one registry entry into an installable shape: the first stdio
 * package wins, else the first remote; npm packages launch through npx.
 */
function resolveServer(entry: RegistryServer): ResolvedServer {
  const name = (entry.name ?? "").replace(/^npm\//, "") || "unknown";
  const pkg = (entry.packages ?? []).find(
    (candidate) => candidate.registry_type === "npm" && candidate.identifier,
  );
  const remote = (entry.remotes ?? []).find((candidate) => candidate.url);
  const identifier = pkg?.identifier;
  return {
    name,
    title: entry.title ?? name,
    description: entry.description ?? "",
    command: pkg ? "npx" : undefined,
    args: identifier ? ["-y", identifier] : undefined,
    url: remote?.url,
    transport: remote?.type === "sse" ? "sse" : "streamable-http",
  };
}

/** `/mcp search <keyword>`: search the public MCP registry. */
async function handleMcpSearch(
  keyword: string | undefined,
): Promise<SlashCommandResult> {
  const query = (keyword ?? "").trim();
  if (query === "") {
    return { output: t("mcp.search.usage") };
  }
  try {
    const url = new URL(MCP_REGISTRY_URL);
    url.searchParams.set("search", query);
    url.searchParams.set("limit", "20");
    const payload = await fetchRegistryJson(url.toString());
    const servers = Array.isArray(payload)
      ? (payload as RegistryServer[])
      : Array.isArray((payload as { servers?: unknown }).servers)
        ? (payload as { servers: RegistryServer[] }).servers
        : [];
    if (servers.length === 0) {
      return { output: t("mcp.search.noMatches", { query }) };
    }
    const lines = servers.map((entry) => {
      const resolved = resolveServer(entry);
      return `  ${resolved.name} - ${resolved.description}`;
    });
    return {
      output: [
        t("mcp.search.header", { count: servers.length }),
        ...lines,
      ].join("\n"),
    };
  } catch (error) {
    return {
      output: t("mcp.search.failed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

/** `/mcp install <name>`: fetch the entry and write it to mcp.json. */
async function handleMcpInstall(
  rawName: string | undefined,
): Promise<SlashCommandResult> {
  const name = (rawName ?? "").trim();
  if (name === "") {
    return { output: t("mcp.install.usage") };
  }
  try {
    const payload = await fetchRegistryJson(
      `${MCP_SERVER_URL}${encodeURIComponent(name)}`,
    );
    const entry = (
      Array.isArray(payload)
        ? (payload as RegistryServer[])[0]
        : (payload as RegistryServer)
    ) as RegistryServer | undefined;
    if (!entry) {
      return { output: t("mcp.search.noMatches", { query: name }) };
    }
    const resolved = resolveServer(entry);
    const { installResolvedServer } =
      await import("../../../mcp/marketplace.js");
    const path = installResolvedServer({
      name: resolved.name,
      title: resolved.title,
      description: resolved.description,
      command: resolved.command,
      args: resolved.args,
      url: resolved.url,
      transport: resolved.transport,
    });
    return { output: t("mcp.install.done", { name: resolved.title, path }) };
  } catch (error) {
    return {
      output: t("mcp.install.failed", {
        name,
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

export const MCP_SUBCOMMANDS = [
  { name: "list", description: t("mcp.sub.list") },
  { name: "market", description: t("mcp.sub.market") },
  { name: "search", description: t("mcp.sub.search") },
  { name: "install", description: t("mcp.sub.install") },
];
