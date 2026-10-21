# Permissions

Tool policies apply in one of six modes: `default`, `acceptEdits`, `plan`, `auto`,
`bypassPermissions` and `dontAsk`.

Every tool call is matched against an ordered policy list. A policy carries one of three
permissions:

- `allow` - the call runs without asking.
- `ask` - the call is shown to the user, who accepts or rejects it.
- `exclude` - the tool is mapped to core's `disabled` policy, so it is not offered.

## Rule precedence

In `default` mode the sources are applied in this order, earlier entries winning per
tool:

1. Command-line flags (`--allow`, `--ask`, `--exclude`)
2. `~/.tnt/settings.json` `permissions` (legacy `permissions.yaml` is read once)
3. Default policies from `getDefaultToolPolicies()` in
   [`src/permissions/defaultPolicies.ts`](../src/permissions/defaultPolicies.ts)

`config.yaml` has no permissions section: permissions live in `settings.json`.

Project-level settings, hooks and MCP files are ignored until you trust their
current contents with `--trust-project` (or `TNT_TRUST_PROJECT=1`); the grant is
recorded per real path and revoked when any of those files change.

`plan` and `bypassPermissions` do not consult this list. They replace it with their own
policy list; `acceptEdits` and `dontAsk` have their own tables as well. See
[modes.md](./modes.md).

## Tool matching

Policies match tool names, and the first matching policy wins:

- `Read` matches the `Read` tool exactly.
- `mcp__github__*` and `external_?` match names with wildcards.
- `*` matches every tool and is used as the fallback.
- `Bash(git status*)` matches `Bash` calls whose `command` argument matches the glob.
  Command matching exists only for `Bash`; a pattern with parentheses on any other tool
  is matched against the tool name and will not match a bare name like `Read`.

When several command-line flags match one tool, `--exclude` is pushed before `--ask`
before `--allow`, so the most restrictive flag wins.

## Command-line flags

Each of `--allow`, `--ask`, and `--exclude` takes one tool matching pattern per
occurrence. Any mode other than `default` refuses them at startup
(`PERMISSION_FLAGS_IGNORED_BY_MODE`), because those modes build their policies from the
mode alone; `--allow "*"` is the escape hatch for headless automation that wants
everything.

```bash
# Allow Read, ask before Write, disable Bash
tnt --allow Read --ask Write --exclude Bash

# Plan mode: documentation writes only, non-writing commands only
tnt --readonly "Help me understand this codebase"
```

## `~/.tnt/permissions.yaml` (personal settings)

A personal file holds the same three lists:

```yaml title="~/.tnt/permissions.yaml"
allow:
  - Read

ask:
  - Write

exclude:
  - Bash
```

The file is created on the first start. The TUI writes to it when the user accepts a
decision with the "always" option, so users normally change it through the TUI rather
than by hand. Entries are matched in `exclude` → `ask` → `allow` order, one tool per
entry.

## Headless mode permissions

Headless runs cannot answer an `ask`. The default table is the same ask baseline used in
the TUI, so write tools, `Bash`, and the wildcard fallback are `ask`; the request builder
excludes `ask` tools in a headless run, which means `-p` does not even offer them to the
model. Opt a tool back in explicitly:

```bash
# Allow file edits but keep shell commands unavailable
tnt -p --allow Write --allow Edit "Rename the helper module"

# Automation escape hatch: every tool, including Bash
tnt -p --allow "*" "Run the test suite and fix what fails"
```
