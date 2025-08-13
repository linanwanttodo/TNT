import chalk from "chalk";

import { loadAllPlugins } from "../../plugins/loader.js";
import { loadKnownMarketplaces } from "../../plugins/marketplaceRegistry.js";
import { runMarketplaceCommand } from "../../plugins/marketplaceCommand.js";
import type { SlashCommandResult } from "../types.js";

export async function handlePlugins(
  args: string[] = [],
): Promise<SlashCommandResult> {
  if (args[0] === "marketplace") {
    const result = await runMarketplaceCommand(args.slice(1));
    return { output: result.output };
  }

  const result = loadAllPlugins();
  const installed = result.plugins;

  const marketplaces = Object.keys(loadKnownMarketplaces()).length;

  if (installed.length === 0) {
    const lines = [
      "No plugins installed.",
      "Add a marketplace: /plugin marketplace add <name> github:<owner>/<repo>",
      "Or place plugins under ~/.tnt/plugins/cache/<marketplace>/<name>/<version>.",
    ];
    if (marketplaces > 0) {
      lines.push(`${marketplaces} marketplace(s) registered`);
    }
    return { exit: false, output: chalk.dim(lines.join("\n")) };
  }

  const lines = installed.map((plugin) => {
    const note = plugin.id !== plugin.name ? ` (${plugin.id})` : "";
    const desc = plugin.description ? ` - ${plugin.description}` : "";
    return `  ${chalk.cyan(plugin.name)}${chalk.dim(note)}${desc}`;
  });

  return {
    exit: false,
    output: [
      chalk.bold(`Installed plugins (${installed.length})`),
      "",
      ...lines,
      "",
      chalk.dim(`${marketplaces} marketplace(s) registered`),
    ].join("\n"),
  };
}
