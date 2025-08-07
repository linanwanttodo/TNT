import chalk from "chalk";

import { loadAllPlugins } from "../../plugins/loader.js";
import type { SlashCommandResult } from "../types.js";

export function handlePlugins(): SlashCommandResult {
  const result = loadAllPlugins();
  const installed = result.plugins;

  if (installed.length === 0) {
    return {
      exit: false,
      output: chalk.dim(
        "No plugins installed. Place plugins under ~/.tnt/plugins/cache/<marketplace>/<name>/<version>/.",
      ),
    };
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
    ].join("\n"),
  };
}
