import { Command } from "commander";

// Function to add common options to any command
export function addCommonOptions(command: Command): Command {
  return command
    .option(
      "--config <path>",
      "Configuration file for the assistant (can be a file path or hub slug)",
    )
    .option(
      "--org <slug>",
      "Organization slug to use for this session (supported only in headless mode)",
    )
    .option("--readonly", "Deprecated alias for plan mode")
    .option(
      "--auto",
      "Deprecated alias for bypassPermissions (all tools allowed)",
    )
    .option(
      "--permission-mode <mode>",
      "Permission mode: default, acceptEdits, plan, auto, bypassPermissions, dontAsk",
    )
    .option(
      "--dangerously-skip-permissions",
      "Allow bypassPermissions mode: every tool runs without asking",
    )
    .option(
      "--mode <mode>",
      "Legacy mode entry: agent (default), plan, or auto (bypassPermissions)",
    )
    .option("--verbose", "Enable verbose logging")
    .option("--beta-status-tool", "Enable beta status tool")
    .option(
      "--rule <rule>",
      "Add a rule (can be a file path, hub slug, or string content). Can be specified multiple times.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--mcp <slug>",
      "Deprecated: MCP servers were loaded from the hub, which has been removed. Add MCP servers to the assistant configuration file instead.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--model <slug>",
      "Deprecated: model packages were loaded from the hub, which has been removed. Add models to the assistant configuration file instead.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--prompt <prompt>",
      "Add to the initial user message (can be a file path, hub slug, or string content). Can be specified multiple times.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--allow <tool>",
      "Allow specified tool (overrides default policies). Can be specified multiple times.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--ask <tool>",
      "Ask for permission before using specified tool (overrides default policies). Can be specified multiple times.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--exclude <tool>",
      "Exclude specified tool from use (overrides default policies). Can be specified multiple times.",
      (value: string, previous: string[] | undefined) => {
        const array = Array.isArray(previous) ? previous : [];
        array.push(value);
        return array;
      },
      [] as string[],
    )
    .option(
      "--agent <slug>",
      "Load an agent from a local markdown path (hub loading has been removed)",
    );
}

// Function to merge parent options into subcommand options
export function mergeParentOptions(parentCommand: Command, options: any): any {
  const parentOpts = parentCommand.opts();
  const mergedOptions = { ...options };

  // List of options to inherit from parent if not present in subcommand
  const inheritableOptions = [
    "config",
    "org",
    "readonly",
    "auto",
    "tools",
    "verbose",
    "rule",
    "mcp",
    "model",
    "prompt",
    "allow",
    "ask",
    "exclude",
    "agent",
    "maxSteps",
  ];

  for (const optName of inheritableOptions) {
    if (
      parentOpts[optName] !== undefined &&
      mergedOptions[optName] === undefined
    ) {
      mergedOptions[optName] = parentOpts[optName];
    }
  }

  return mergedOptions;
}
