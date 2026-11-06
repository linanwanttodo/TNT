import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import { loadAllPlugins } from "../../../plugins/loader.js";
import { runMarketplaceCommand } from "../../../plugins/marketplaceCommand.js";
import { createDefaultDeps } from "../../../plugins/marketplaceManager.js";
import { loadKnownMarketplaces } from "../../../plugins/marketplaceRegistry.js";
import {
  ensureDefaultMarketplace,
  loadMarketplaceCatalogs,
  searchCatalogPlugins,
} from "../../../plugins/discover.js";
import {
  installPluginWithDependencies,
  uninstallPlugin,
} from "../../../plugins/pluginInstall.js";
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
  // A bare install with nothing registered auto-adds the official catalogue
  // instead of dead-ending on "add a marketplace first".
  if (Object.keys(loadKnownMarketplaces()).length === 0) {
    const ensured = await ensureDefaultMarketplace();
    if (!ensured.registered) {
      return { output: ensured.message };
    }
  }
  const { name, marketplace } = splitPluginReference(reference);
  const resolved = resolveMarketplace(name, marketplace);
  if (!resolved.marketplace) {
    return { output: resolved.problem ?? t("plugin.noMarketplace") };
  }
  try {
    const plan = await installPluginWithDependencies(
      resolved.marketplace,
      name,
      createDefaultDeps(),
    );
    const installed = plan.installed[plan.installed.length - 1];
    const sha = installed.gitCommitSha
      ? ` at ${installed.gitCommitSha.slice(0, 8)}`
      : "";
    const lines = [
      `${installed.reused ? t("plugin.alreadyInstalled", { id: installed.id, version: installed.version }) : t("plugin.installed", { id: installed.id, version: installed.version })}${sha}`,
      `  ${installed.installPath}`,
    ];
    const dependencies = plan.installed.slice(0, -1);
    if (dependencies.length > 0) {
      lines.push(
        t("plugin.dependenciesInstalled", {
          list: dependencies.map((entry) => entry.id).join(", "),
        }),
      );
    }
    return { output: lines.join("\n") };
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
    return { output: resolved.problem ?? t("plugin.noMarketplace") };
  }
  const id = `${name}@${resolved.marketplace}`;
  const removed = uninstallPlugin(id);
  return {
    output: removed
      ? t("plugin.uninstallDone", { id })
      : t("plugin.uninstallMissing", { id }),
  };
}

/** `/plugins search <keyword>`: keyword filter over every registered catalog. */
async function handleSearch(keyword: string | undefined) {
  const ensured = await ensureDefaultMarketplace();
  const notes = ensured.registered ? [chalk.dim(ensured.message)] : [];
  const matches = searchCatalogPlugins(
    loadMarketplaceCatalogs(),
    keyword ?? "",
  );
  if (matches.length === 0) {
    return { output: [...notes, t("plugin.searchNoMatches")].join("\n") };
  }
  const lines = matches.slice(0, 30).map((match) => {
    const category = match.plugin.category ? ` [${match.plugin.category}]` : "";
    return `  ${chalk.cyan(match.plugin.name)}${chalk.dim(`@${match.marketplace}`)}${category} - ${match.plugin.description ?? ""}`;
  });
  const more =
    matches.length > 30 ? chalk.dim(`\n${t("plugin.searchTruncated")}`) : "";
  return {
    output:
      [
        ...notes,
        t("plugin.searchHeader", { count: matches.length }),
        ...lines,
      ].join("\n") + more,
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
  if (args[0] === "search") {
    return await handleSearch(args.slice(1).join(" "));
  }

  // No recognized subcommand opens the browser, the way the reference client
  // treats a bare /plugin; text mode stays reachable through the subcommands.
  if (args.length === 0) {
    return { openPluginsBrowser: true };
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
    const note = plugin.id === plugin.name ? "" : ` (${plugin.id})`;
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
      chalk.dim(t("plugin.marketplacesRegistered", { count: marketplaces })),
      "",
      chalk.dim(t("plugin.usageHint")),
    ].join("\n"),
  };
}
