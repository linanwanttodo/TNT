# Modes

A mode decides where tool policies come from. The values match Claude Code:
`default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`, `dontAsk`.

## `default` (default)

The configuration layers apply in this order:

1. Command-line overrides (`--allow`, `--ask`, `--exclude`)
2. `~/.tnt/permissions.yaml`
3. Default tool policies

Reads and searches are allowed; write tools and Bash ask before running. Headless runs
drop ask tools and refuse a call that reaches approval.

## `acceptEdits`

Reserved for the mode that allows edits inside the workspace automatically. Until its
policy table lands it uses the `default` table, so it is currently identical in effect.

## `plan`

The policy list is `PLAN_MODE_POLICIES`; the configuration file and the command-line
overrides are not consulted. The current list allows documentation writes inside the
workspace and only provably non-writing shell commands; MCP and plugin tools fall
through to the wildcard allow. The read-only tightening is a separate change.

The composer's top border is labelled `[plan]` in blue.

## `auto`

The classifier mode is not implemented. No flag selects it: the legacy `--mode auto`
maps to `bypassPermissions`. It is not part of the Shift+Tab cycle.

## `bypassPermissions`

`BYPASS_PERMISSIONS_POLICIES` allows every tool. Entry requires an explicit opt-in
(the legacy `--auto` alias, or a dedicated bypass flag once it lands); it is never part
of the Shift+Tab cycle. The composer labels it `[bypassPermissions]` in green.

## `dontAsk`

Headless and serve semantics: the same table as `default`, with every ask turned into a
denial because there is nobody to prompt.

Entry to `plan` and `bypassPermissions` is refused when `--allow`, `--ask` or
`--exclude` is also present (`PERMISSION_FLAGS_IGNORED_BY_MODE`): those modes
build their policies from the mode alone.

## Aliases

- `--mode agent` maps to `default`
- `--readonly` maps to `plan`
- `--auto` maps to `bypassPermissions`

## Switching

Shift+Tab cycles `default → acceptEdits → plan → default`. The workspace name stays
visible in the status bar in every mode; the mode itself is shown on the composer
border.
