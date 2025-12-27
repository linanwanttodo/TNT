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

The CLI has an MCP Service should manage connections to MCP servers and provide state to the terminal app regarding MCP server connections.
Service initialization for MCP servers can take especially long, so it should not block service initialization. Instead, initialization should kick off server connections and then resolve.
All configured server connections can be initialized simultaneously using Promise.all
Each server configuration should have its own connection and state separated, but the service should also have an easy way to retrieve all tools and prompts from all servers to pass to the model.
Servers should have a status "idle", "connecting", "connected", or "error". Only "connected" servers contribute prompts and tools.
If a server successfully connects but there is an error retrieving prompts or tools, it should have an array of warning messages that can be accessed in the terminal app.
When the process exits, all servers should be shut down and disconnected.
Only MCP servers for the CURRENT config should be loaded

- Logs from MCP servers should be routed through the winston logger, not the standard console.log (since this is a terminal app)

## MCP slash command

Users can manage MCP connections using the /mcp slash command.
/mcp shows a menu with the following options

- "No servers" if there are no servers
- Restart all servers
- Stop all servers
- View servers
- Back (esc also goes back)

View servers should open a submenu that has each server name with its status icon

- red if error, yellow if warnings, green if connected, gray if idle
- "No Servers" if there are none
- Back (esc also goes back)

Finally, selecting a server opens a sub-submenu that keeps the name/icon as header and lists

- Back (esc also goes back)
- Restart server
- Stop server
- warnings the server currently has
- prompts the server contributes
- tools the server contributes
