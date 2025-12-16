# Permissions

Tool policies apply in one of six modes: `default`, `acceptEdits`, `plan`, `auto`,
`bypassPermissions` and `dontAsk`.

Every tool call is matched against an ordered policy list. A policy carries one of three
permissions:

- `allow` - the call runs without asking.
- `ask` - the call is shown to the user, who accepts or rejects it.
- `exclude` - the tool is mapped to core's `disabled` policy, so it is not offered.

## Rule precedence

In `agent` mode the sources are applied in this order, earlier entries winning per tool:

1. Command-line flags (`--allow`, `--ask`, `--exclude`)
2. `~/.tnt/permissions.yaml`
3. Default policies from `getDefaultToolPolicies()` in
   [`src/permissions/defaultPolicies.ts`](../src/permissions/defaultPolicies.ts)

The `permissions` section of `config.yaml` is not implemented.

`plan` and `bypassPermissions` do not consult this list. They replace it with their own
policy list; see [modes.md](./modes.md). `acceptEdits` and `dontAsk` use the same layers
until their own behaviour lands.

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
occurrence. A mode flag (`--readonly`, `--auto`, `--mode`) combined with any of them is
refused at startup, because plan and auto build their policies from the mode alone.

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
