# Modes

A mode decides where tool policies come from. Three modes are available:

- `agent` (default) - command-line overrides, then `~/.tnt/permissions.yaml`, then the
  built-in defaults.
- `plan` - a fixed list that permits only provably non-writing actions.
- `auto` - a single `{ tool: "*", permission: "allow" }` policy.

Set the mode at startup with `--mode <agent|plan|auto>`, `--readonly` (plan), or
`--auto`. `--readonly` and `--auto` cannot be combined, and neither can a mode flag be
combined with `--allow`, `--ask`, or `--exclude`: `plan` and `auto` build their policies
from the mode alone, so the combination is refused at startup with
`PERMISSION_FLAGS_IGNORED_BY_MODE` rather than accepted and silently ignored.

## `agent` (default)

Policies are resolved in this order, earlier sources overriding later ones per tool:

1. Command-line overrides (`--allow`, `--ask`, `--exclude`)
2. `~/.tnt/permissions.yaml`
3. Default tool policies

Reads and searches are allowed; write tools and Bash ask before running. Headless runs
cannot prompt, so there the ask policies are auto-allowed and `--ask`/`--exclude` still
narrow them per run. No mode badge is shown.

## `plan`

The policy list is `PLAN_MODE_POLICIES`; the configuration file and the command-line
overrides are not consulted.

- Write tools are allowed only for documentation files inside the workspace. Any other
  write call is refused.
- Bash is allowed only for commands the classifier proves non-writing; an unrecognized
  command is refused rather than sent.
- Reads, searches, diagnostics, subagents and built-in bookkeeping tools are allowed.
- MCP and plugin tools fall through to the wildcard allow, because plan mode cannot
  inspect a third-party tool's effects. Run only trusted MCP servers in plan mode.
- `EnterPlanMode` is allowed; `ExitPlanMode` asks.

The composer's top border is labelled `[plan]` in blue.

## `auto`

The policy list is `AUTO_MODE_POLICIES`: every tool, including MCP and plugin tools, is
allowed without asking. The configuration file and the command-line overrides are not
consulted. The composer's top border is labelled `[auto]` in green.

## Switching

Shift+Tab cycles `agent → plan → auto → agent` during a chat session. Entering `plan`
or `auto` stores the policies that were active in `agent` mode and replaces them with the
mode's own list; returning to `agent` restores the stored policies. The workspace name
stays visible in the status bar in every mode; the mode itself is shown on the composer
border.
