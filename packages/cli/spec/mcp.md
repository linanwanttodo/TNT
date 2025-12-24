# TNT CLI Model Context Protocol (MCP) integration

## Intro

Model Context Protocol is a protocol for giving models access to resources and tools. MCP servers can run locally (stdio) or be remote (http/streamable/etc). See https://modelcontextprotocol.io/specification. The TNT CLI uses MCP to extend model's capabilities with MCP prompts and tools.

## Configuration files

Server definitions live in `mcp.json`, not in `config.yaml`:

- `mcp.json` in the user TNT home directory - user servers
- a project-level `mcp.json` in the project's TNT directory, applied only after
  the project is trusted
- `.mcp.json` at the repository root - Claude-compatible project layer,
  read-only and also trust-gated

Each file is `{ "mcpServers": { "<name>": { "command": ..., "args": [...] } } }`.
Files apply in the order listed above, and servers merge by name: a later file
replaces an earlier server with the same name and leaves the others alone. The
root `.mcp.json` therefore wins over a TNT project server of the same name.
`mcpServers` in `config.yaml` is still read for one version with a deprecation
warning.

## Secret Resolution

MCP server entries in `mcp.json` are connected exactly as written: template
variables are not expanded there. A server whose configuration still contains a
`${{ secrets.NAME }}` reference gets an unresolved-secret warning, and in
headless mode it fails to start instead of running with the literal text.

For a stdio server, export the value in the parent environment: the CLI passes
its own environment through to the child process, so a server that reads
`API_KEY` from its environment works without any templating.

The deprecated `config.yaml:mcpServers` path is different: those entries are
expanded during config unrolling against the process environment, then
`~/.tnt/.env`, then `<workspace>/.tnt/.env`, then `<workspace>/.env`. Move
server definitions to `mcp.json` and use one of the two approaches above.

## MCP Service

The MCP service manages connections and publishes their state to the TUI.
Connecting never blocks service initialization: connections start together and
initialization resolves without waiting for them. Each server keeps its own
connection and state, and the service exposes the tools and prompts of all
connected servers to the model.

A server is `idle`, `connecting`, `connected` or `error`; only `connected`
servers contribute prompts and tools. A server that connects but fails to list
prompts or tools records warnings for the TUI instead of failing the whole
service. On exit every connection is shut down.

Only servers from the loaded configuration files are connected. MCP logging goes
through the winston logger, never `console.log`.

## MCP slash command

`/mcp` opens the server manager. The main menu lists one row per configured
server (status icon, name, and tool/prompt counts when connected), then offers
`Restart all servers` and `Stop all servers` when at least one connection
exists, then `Explore MCP Servers` and `Back` (`esc` also goes back).
`Explore MCP Servers` opens the install/discovery flow.

Selecting a server opens its detail view. The header keeps the icon, name and
status; the actions are `Restart server`, and `Stop server` only while the
server is connected. Below them the view shows the server's error, its warnings,
and the prompts and tools it contributes.

Status icons are green for a connected server, yellow while connecting or when
a connected server has warnings, red for an error, and gray for idle.
