# Configuration loading

The CLI reads configuration from local files only. Nothing is fetched over the
network during a load.

## Source precedence

1. `--config <path>` - a local YAML file. The path must be a file path (`.`,
   `/`, `~`, a drive letter, a UNC path, or a name ending in `.yaml`, `.yml` or
   `.json`). A hub slug such as `owner/package` is refused with a reason; the
   slug loader and the saved config URI are gone.
2. `config.yaml` in the TNT home directory - written by the interactive
   provider setup.
3. No config: interactive runs go through the provider setup, which writes that
   file. Embedders and tests that skip onboarding get the injected blocks alone.

The loaded config carries models, rules and prompts. Permissions live in
`settings.json`, MCP servers in `mcp.json`, and credentials in `auth.json`; see
[permissions.md](./permissions.md) and [mcp.md](./mcp.md).

## Settings that are not part of model loading

`settings.json` supplies permissions, hooks, non-secret environment variables,
locale, output style and the default mode. Project-level settings, hooks and MCP
files are ignored until trusted with `--trust-project` (or
`TNT_TRUST_PLACEHOLDER`), and the grant is revoked when their contents change.

## Errors

- A `--config` file that fails to parse exits with the loader's message for that
  path.
- A slug passed to `--config` exits with the slug-removed message.
- With no local config and no injected blocks, the loader produces an empty
  configuration; a headless run then reports that no model was specified rather
  than fetching a default assistant.
