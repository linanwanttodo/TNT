import { Emitter } from "@zcode/rpc";
import { IPluginManagementService, IPluginsService } from "@zcode/services";
import type {
  ZCodePluginOperationProgressNotification,
  ZCodePluginsConfigureResult,
  ZCodePluginsInstallResult,
  ZCodePluginsMarketplaceMutationResult,
  ZCodePluginsRestoreBuiltinResult,
  ZCodePluginsSetEnabledResult,
  ZCodePluginsUninstallResult,
} from "@zcode/shared";

import {
  addMarketplace,
  createDefaultDeps,
  refreshMarketplace,
} from "../../plugins/marketplaceManager.js";
import {
  forgetMarketplace,
  loadKnownMarketplaces,
} from "../../plugins/marketplaceRegistry.js";
import {
  installPlugin as installMarketplacePlugin,
  installPluginWithDependencies,
  uninstallPlugin as uninstallPluginRecord,
} from "../../plugins/pluginInstall.js";

import {
  catalogEntry,
  catalogIndex,
  describePluginFrom,
  discoverPlugins,
  installedAtById,
  legacyOverview,
  listCatalog,
  overviewCatalog,
  persistPluginEnabled,
  pluginFromSnapshot,
  readCatalogs,
  referenceCatalog,
  reloadSnapshot,
  removePluginDirectory,
  snapshotPlugins,
} from "./pluginCatalog.js";
import { isUnavailableError, unavailable } from "./pluginErrors.js";
import {
  diagnostic,
  installSummaryFallback,
  installedSummary,
  marketplaceSummary,
  pluginInfo,
  splitPluginId,
} from "./pluginMapping.js";
import {
  assertInstallableSource,
  dryRunSource,
  parseSourceOrUnavailable,
  suggestedMarketplaceName,
} from "./pluginSources.js";
import { validateTarget } from "./pluginValidation.js";

type OperationEmitter = Emitter<ZCodePluginOperationProgressNotification>;

export interface ZcodePluginServices {
  readonly pluginsService: IPluginsService;
  readonly pluginManagementService: IPluginManagementService;
  dispose(): void;
}

/**
 * The web UI's plugin management surface on top of TNT's plugin loader and
 * marketplace registry.
 *
 * TNT installs into a per-host cache and stores enablement in the project's
 * settings file, so every operation reads the workspace it is handed rather
 * than capturing one. The marketplace catalogue is TNT's own registry; sources
 * TNT cannot fetch are reported as `ZCODE_UNAVAILABLE` instead of being
 * silently treated as empty. The UI's `restoreBuiltinPlugin` targets a plugin
 * still listed by a registered marketplace, because TNT ships no built-in
 * plugin tree of its own.
 */
export function createZcodePluginServices(): ZcodePluginServices {
  const channel = IPluginManagementService.channelName;
  const emitters = new Map<string, OperationEmitter>();

  const emitterFor = (operationId: string): OperationEmitter => {
    const existing = emitters.get(operationId);
    if (existing) return existing;
    const emitter: OperationEmitter = new Emitter({
      onDidRemoveLastListener: () => {
        emitters.delete(operationId);
        emitter.dispose();
      },
    });
    emitters.set(operationId, emitter);
    return emitter;
  };

  const emitProgress = (operationId: string | undefined): void => {
    if (!operationId) return;
    emitterFor(operationId).fire({ operationId, state: "refreshing" });
  };

  const addMarketplaceSource = async (
    source: string,
    operationId: string | undefined,
    dryRun: boolean | undefined,
  ): Promise<ZCodePluginsMarketplaceMutationResult> => {
    const parsed = parseSourceOrUnavailable(source, channel);
    const name = suggestedMarketplaceName(parsed);
    if (dryRun) {
      return { diagnostics: dryRunSource(parsed, name) };
    }
    emitProgress(operationId);
    const result = await addMarketplace(name, parsed, createDefaultDeps());
    return {
      marketplace: marketplaceSummary({
        name,
        record: result.marketplace,
        manifest: result.manifest,
      }),
      diagnostics: [],
    };
  };

  const refreshMarketplaces = async (
    marketplace: string | undefined,
    operationId: string | undefined,
  ): Promise<ZCodePluginsMarketplaceMutationResult> => {
    emitProgress(operationId);
    const targets = marketplace
      ? [marketplace]
      : Object.keys(loadKnownMarketplaces()).sort();
    const diagnostics = [];
    for (const target of targets) {
      try {
        // refreshMarketplace also upgrades installed plugins whose catalogue
        // version moved, which is the marketplace-level "update all" the UI
        // exposes next to the per-plugin update.
        const summary = await refreshMarketplace(target, createDefaultDeps());
        for (const failed of summary.failed) {
          diagnostics.push(
            diagnostic(
              "plugin_update_failed",
              failed.message,
              "error",
              failed.id,
            ),
          );
        }
      } catch (error) {
        diagnostics.push(
          diagnostic(
            "marketplace_refresh_failed",
            (error as Error).message,
            "error",
          ),
        );
      }
    }
    const catalogs = readCatalogs();
    const selected = marketplace
      ? catalogs.find((catalog) => catalog.name === marketplace)
      : undefined;
    return {
      ...(selected ? { marketplace: marketplaceSummary(selected) } : {}),
      marketplaces: catalogs.map(marketplaceSummary),
      diagnostics,
    };
  };

  const installPluginInto = async (
    workspacePath: string,
    marketplace: string,
    pluginName: string,
    dryRun: boolean | undefined,
    operationId: string | undefined,
  ): Promise<ZCodePluginsInstallResult> => {
    emitProgress(operationId);
    const pluginId = `${pluginName}@${marketplace}`;
    try {
      assertInstallableSource(
        catalogEntry(marketplace, pluginName).source,
        channel,
      );
      if (dryRun) {
        return { installedPlugins: [], dependencyClosure: [], diagnostics: [] };
      }
      const plan = await installPluginWithDependencies(
        marketplace,
        pluginName,
        createDefaultDeps(),
      );
      const snapshot = reloadSnapshot(workspacePath);
      const loaded = discoverPlugins();
      const index = catalogIndex(readCatalogs());
      const installedAt = installedAtById();
      const installedPlugins = plan.installed.map((entry) => {
        const summary = snapshot.plugins.find(
          (plugin) => plugin.id === entry.id,
        );
        return summary
          ? installedSummary(
              summary,
              loaded.get(entry.id),
              snapshot,
              index,
              installedAt.get(entry.id),
            )
          : installSummaryFallback(entry);
      });
      return {
        installedPlugins,
        dependencyClosure: plan.installed.map((entry) => entry.id),
        diagnostics: [],
      };
    } catch (error) {
      if (isUnavailableError(error)) throw error;
      return {
        installedPlugins: [],
        dependencyClosure: [],
        diagnostics: [
          diagnostic(
            "plugin_install_failed",
            (error as Error).message,
            "error",
            pluginId,
          ),
        ],
      };
    }
  };

  const uninstallPluginFrom = (
    workspacePath: string,
    params: { pluginId?: string; pluginName?: string; marketplace?: string },
  ): ZCodePluginsUninstallResult => {
    const snapshot = snapshotPlugins(workspacePath);
    const target =
      (params.pluginId
        ? pluginFromSnapshot(snapshot, params.pluginId)
        : undefined) ??
      (params.pluginName && params.marketplace
        ? pluginFromSnapshot(
            snapshot,
            `${params.pluginName}@${params.marketplace}`,
          )
        : undefined) ??
      (params.pluginName
        ? pluginFromSnapshot(snapshot, params.pluginName)
        : undefined);
    if (!target) {
      throw new Error(
        `Plugin ${params.pluginId ?? params.pluginName ?? "(unknown)"} is not installed`,
      );
    }
    const removedPlugin = installedSummary(
      target,
      discoverPlugins().get(target.id),
      snapshot,
      catalogIndex(readCatalogs()),
      installedAtById().get(target.id),
    );
    removePluginDirectory(target.path);
    uninstallPluginRecord(target.id);
    reloadSnapshot(workspacePath);
    return { removedPlugin, diagnostics: [] };
  };

  const restoreBuiltin = async (
    workspacePath: string,
    pluginId: string,
  ): Promise<ZCodePluginsRestoreBuiltinResult> => {
    const { name, marketplace } = splitPluginId(pluginId);
    try {
      assertInstallableSource(catalogEntry(marketplace, name).source, channel);
      await installMarketplacePlugin(marketplace, name, createDefaultDeps());
      reloadSnapshot(workspacePath);
      return { pluginId, diagnostics: [] };
    } catch (error) {
      if (isUnavailableError(error)) throw error;
      return {
        pluginId,
        diagnostics: [
          diagnostic(
            "plugin_restore_failed",
            (error as Error).message,
            "error",
            pluginId,
          ),
        ],
      };
    }
  };

  const pluginManagementService: IPluginManagementService = {
    async listPlugins(params) {
      return listCatalog(params.workspacePath);
    },
    async getPluginReferenceCatalog(params) {
      return referenceCatalog(params.workspacePath, params.sessionId, channel);
    },
    async resolveSuggestedPluginReference(params) {
      emitProgress(params.operationId);
      return {
        stableId: params.stableId,
        status: "unavailable",
        diagnostics: [
          diagnostic(
            "recommendation_unavailable",
            "TNT does not serve official plugin recommendations",
            "warning",
          ),
        ],
      };
    },
    onDynamicPluginOperationProgress(operationId) {
      return emitterFor(operationId).event;
    },
    async getPluginsOverview(params) {
      return overviewCatalog(params.workspacePath);
    },
    async addPluginMarketplace(params) {
      return addMarketplaceSource(
        params.source,
        params.operationId,
        params.dryRun,
      );
    },
    async removePluginMarketplace(params) {
      const removed = forgetMarketplace(params.marketplace);
      if (!removed) {
        throw new Error(`Marketplace ${params.marketplace} is not registered`);
      }
      return {
        marketplaces: readCatalogs().map(marketplaceSummary),
        diagnostics: [],
      };
    },
    async updatePluginMarketplace(params) {
      return refreshMarketplaces(params.marketplace, params.operationId);
    },
    async installPlugin(params) {
      return installPluginInto(
        params.workspacePath,
        params.marketplace,
        params.pluginName,
        params.dryRun,
        params.operationId,
      );
    },
    async cancelPluginOperation(params) {
      return { operationId: params.operationId, cancelled: false };
    },
    async uninstallPlugin(params) {
      return uninstallPluginFrom(params.workspacePath, params);
    },
    async updatePlugin(params) {
      const snapshot = snapshotPlugins(params.workspacePath);
      const target = params.pluginId
        ? pluginFromSnapshot(snapshot, params.pluginId)
        : undefined;
      if (!target) {
        return {
          installedPlugins: [],
          dependencyClosure: [],
          diagnostics: [
            diagnostic(
              "plugin_not_installed",
              `Plugin ${params.pluginId ?? "(unknown)"} is not installed`,
            ),
          ],
        };
      }
      const { name, marketplace } = splitPluginId(target.id);
      return installPluginInto(
        params.workspacePath,
        marketplace,
        name,
        false,
        undefined,
      );
    },
    async restoreBuiltinPlugin(params) {
      return restoreBuiltin(params.workspacePath, params.pluginId);
    },
    async configurePlugin(): Promise<ZCodePluginsConfigureResult> {
      return unavailable(channel);
    },
    async resetPluginConfig(): Promise<ZCodePluginsConfigureResult> {
      return unavailable(channel);
    },
    async validatePlugin(params) {
      return validateTarget(params, channel);
    },
    async describePlugin(params) {
      return describePluginFrom(params);
    },
    async setPluginEnabled(params): Promise<ZCodePluginsSetEnabledResult> {
      const snapshot = persistPluginEnabled(
        params.pluginId,
        params.enabled,
        params.workspacePath,
      );
      const target = pluginFromSnapshot(snapshot, params.pluginId);
      if (!target) {
        throw new Error(`Plugin ${params.pluginId} is not installed`);
      }
      return {
        plugin: pluginInfo(target, discoverPlugins().get(target.id), snapshot),
        enabled: target.enabled,
      };
    },
  };

  const pluginsService: IPluginsService = {
    async getOverview(params) {
      return legacyOverview(params.workspacePath);
    },
    async addMarketplace(params) {
      await addMarketplaceSource(params.source, undefined, false);
    },
    async removeMarketplace(params) {
      const removed = forgetMarketplace(params.marketplace);
      if (!removed) {
        throw new Error(`Marketplace ${params.marketplace} is not registered`);
      }
    },
    async updateMarketplace(params) {
      return refreshMarketplaces(params.marketplace, undefined);
    },
    async installPlugin(params) {
      const result = await installPluginInto(
        params.workspacePath,
        params.marketplace,
        params.pluginName,
        false,
        undefined,
      );
      const failure = result.diagnostics.find(
        (entry) => entry.severity !== "warning",
      );
      if (failure) {
        throw new Error(failure.message);
      }
    },
    async uninstallPlugin(params) {
      uninstallPluginFrom(params.workspacePath, params);
    },
    async setPluginEnabled(params) {
      persistPluginEnabled(
        params.pluginName,
        params.enabled,
        params.workspacePath,
      );
    },
  };

  return {
    pluginsService,
    pluginManagementService,
    dispose(): void {
      for (const emitter of emitters.values()) emitter.dispose();
      emitters.clear();
    },
  };
}
