import chalk from "chalk";

import { t } from "../../i18n/index.js";

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
    return { problem: t("plugin.needMarketplace") };
  }
  return {
    problem: t("plugin.chooseMarketplace", {
      list: registered.join(", "),
      name,
    }),
  };
}

async function handleInstall(reference: string | undefined) {
  if (!reference) {
    return { output: t("plugin.installUsage") };
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
      output: `${installed.reused ? t("plugin.alreadyInstalled", { id: installed.id, version: installed.version }) : t("plugin.installed", { id: installed.id, version: installed.version })}${sha}\n  ${installed.installPath}`,
    };
  } catch (error) {
    return {
      output: t("plugin.installFailed", {
        reference,
        message: (error as Error).message,
      }),
    };
  }
}

function handleUninstall(reference: string | undefined) {
  if (!reference) {
    return { output: t("plugin.uninstallUsage") };
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
      ? t("plugin.uninstallDone", { id })
      : t("plugin.uninstallMissing", { id }),
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
      t("plugin.none"),
      t("plugin.addMarketplaceHint"),
      t("plugin.installHint"),
      t("plugin.placeHint"),
    ];
    if (marketplaces > 0) {
      lines.push(t("plugin.marketplacesRegistered", { count: marketplaces }));
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
      chalk.bold(t("plugin.installedHeader", { count: installed.length })),
      "",
      ...lines,
      "",
      chalk.dim(`${marketplaces} marketplace(s) registered`),
    ].join("\n"),
  };
}
