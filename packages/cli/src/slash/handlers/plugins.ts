import chalk from "chalk";

import { loadAllPlugins } from "../../plugins/loader.js";
import { runMarketplaceCommand } from "../../plugins/marketplaceCommand.js";
import { createDefaultDeps } from "../../plugins/marketplaceManager.js";
import { loadKnownMarketplaces } from "../../plugins/marketplaceRegistry.js";
import { installPlugin, uninstallPlugin } from "../../plugins/pluginInstall.js";
import type { SlashCommandResult } from "../types.js";

function splitPluginReference(reference: string): {
  name: string;
  marketplace?: string;
} {
  const at = reference.lastIndexOf("@");
  if (at <= 0) return { name: reference };
  return { name: reference.slice(0, at), marketplace: reference.slice(at + 1) };
}

/**
 * A bare plugin name is only unambiguous when exactly one marketplace knows it,
 * so anything else asks the user to name the marketplace instead of guessing.
 */
function resolveMarketplace(
  name: string,
  explicit?: string,
): { marketplace?: string; problem?: string } {
  if (explicit) return { marketplace: explicit };
  const registered = Object.keys(loadKnownMarketplaces());
  if (registered.length === 1) return { marketplace: registered[0] };
  if (registered.length === 0) {
    return { problem: "No marketplaces registered. Add one first." };
  }
  return {
    problem: `Name the marketplace: Registered are ${registered.join(", ")}. Use ${name}@<marketplace>`,
  };
}

async function handleInstall(reference: string | undefined) {
  if (!reference) {
    return { output: "Usage: /plugin install <name>[@marketplace]" };
  }
  const { name, marketplace } = splitPluginReference(reference);
  const resolved = resolveMarketplace(name, marketplace);
  if (!resolved.marketplace) {
    return { output: resolved.problem ?? "No marketplace to install from." };
  }
  try {
    const installed = await installPlugin(
      resolved.marketplace,
      name,
      createDefaultDeps(),
    );
    const sha = installed.gitCommitSha
      ? ` at ${installed.gitCommitSha.slice(0, 8)}`
      : "";
    return {
      output: `${installed.reused ? "Already installed" : "Installed"} ${installed.id} ${installed.version}${sha}\n  ${installed.installPath}`,
    };
  } catch (error) {
    return {
      output: `Could not install ${reference}: ${(error as Error).message}`,
    };
  }
}

function handleUninstall(reference: string | undefined) {
  if (!reference) {
    return { output: "Usage: /plugin uninstall <name>[@marketplace]" };
  }
  const { name, marketplace } = splitPluginReference(reference);
  const resolved = resolveMarketplace(name, marketplace);
  if (!resolved.marketplace) {
    return { output: resolved.problem ?? "No marketplace to uninstall from." };
  }
  const id = `${name}@${resolved.marketplace}`;
  const removed = uninstallPlugin(id);
  return {
    output: removed
      ? `Removed ${id} from the registry. Its cached files stay until cleaned.`
      : `No installation recorded for ${id}.`,
  };
}

export async function handlePlugins(
  args: string[] = [],
): Promise<SlashCommandResult> {
  if (args[0] === "marketplace") {
    const result = await runMarketplaceCommand(args.slice(1));
    return { output: result.output };
  }
  if (args[0] === "install") {
    return await handleInstall(args[1]);
  }
  if (args[0] === "uninstall") {
    return handleUninstall(args[1]);
  }

  const result = loadAllPlugins();
  const installed = result.plugins;
  const marketplaces = Object.keys(loadKnownMarketplaces()).length;

  if (installed.length === 0) {
    const lines = [
      "No plugins installed.",
      "Add a marketplace: /plugin marketplace add <name> github:<owner>/<repo>",
      "Then install: /plugin install <name>@<marketplace>",
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
