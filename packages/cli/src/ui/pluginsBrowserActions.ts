import { useState } from "react";

import { t } from "../i18n/index.js";
import {
  createDefaultDeps,
  refreshMarketplace,
} from "../plugins/marketplaceManager.js";
import {
  installPluginWithDependencies,
  uninstallPlugin,
} from "../plugins/pluginInstall.js";
import { setPluginEnabled } from "../services/webuiPlugins.js";

import type { ListRow } from "./pluginsBrowserModel.js";

export interface BrowserStatus {
  message: string;
  error?: boolean;
}

export interface PluginActions {
  busy: string | null;
  status: BrowserStatus | null;
  errors: Record<string, string>;
  installAt: (name: string, marketplace: string) => Promise<void>;
  updateAt: (name: string, marketplace: string) => Promise<void>;
  toggleAt: (id: string, enabled: boolean) => void;
  uninstallAt: (id: string) => void;
  refreshMarketplaceRow: (row: ListRow) => Promise<void>;
}

interface PluginActionsOptions {
  reloadCatalogs: () => void;
  bumpInstalled: () => void;
}

/**
 * The plugin operations the browser runs. Kept beside the view rather than in
 * it so a failed install, update, toggle or uninstall leaves the same details
 * screen in place with its error attached to that plugin.
 */
export function usePluginActions({
  reloadCatalogs,
  bumpInstalled,
}: PluginActionsOptions): PluginActions {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (id: string) => {
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const fail = (id: string, message: string, summary: string) => {
    setErrors((prev) => ({ ...prev, [id]: message }));
    setStatus({ message: summary, error: true });
  };

  const installAt = async (name: string, marketplace: string) => {
    const id = `${name}@${marketplace}`;
    if (!marketplace) {
      fail(id, t("plugin.noMarketplace"), t("plugin.noMarketplace"));
      return;
    }
    setBusy(id);
    clearError(id);
    setStatus({ message: t("plugins.browser.installing", { id }) });
    try {
      const plan = await installPluginWithDependencies(
        marketplace,
        name,
        createDefaultDeps(),
      );
      const installed = plan.installed[plan.installed.length - 1];
      bumpInstalled();
      setStatus({
        message: t("plugin.installed", {
          id: installed.id,
          version: installed.version,
        }),
      });
    } catch (error) {
      const message = (error as Error).message;
      fail(id, message, t("plugin.installFailed", { reference: id, message }));
    } finally {
      setBusy(null);
    }
  };

  const updateAt = async (name: string, marketplace: string) => {
    const id = `${name}@${marketplace}`;
    if (!marketplace) {
      fail(id, t("plugin.noMarketplace"), t("plugin.noMarketplace"));
      return;
    }
    setBusy(id);
    clearError(id);
    setStatus({ message: t("plugins.browser.updating", { id }) });
    try {
      await refreshMarketplace(marketplace, createDefaultDeps(), {
        updatePlugins: false,
      });
      const plan = await installPluginWithDependencies(
        marketplace,
        name,
        createDefaultDeps(),
      );
      const installed = plan.installed[plan.installed.length - 1];
      reloadCatalogs();
      bumpInstalled();
      setStatus({
        message: t("plugins.browser.updated", {
          id: installed.id,
          version: installed.version,
        }),
      });
    } catch (error) {
      const message = (error as Error).message;
      fail(id, message, t("plugins.browser.updateFailed", { id, message }));
    } finally {
      setBusy(null);
    }
  };

  const toggleAt = (id: string, enabled: boolean) => {
    setBusy(id);
    clearError(id);
    try {
      setPluginEnabled(id, !enabled);
      bumpInstalled();
      setStatus({
        message: enabled
          ? t("plugins.browser.disableDone", { id })
          : t("plugins.browser.enableDone", { id }),
      });
    } catch (error) {
      const message = (error as Error).message;
      fail(
        id,
        message,
        enabled
          ? t("plugins.browser.disableFailed", { id, message })
          : t("plugins.browser.enableFailed", { id, message }),
      );
    } finally {
      setBusy(null);
    }
  };

  const uninstallAt = (id: string) => {
    setBusy(id);
    clearError(id);
    try {
      const removed = uninstallPlugin(id);
      bumpInstalled();
      setStatus({
        message: removed
          ? t("plugin.uninstallDone", { id })
          : t("plugin.uninstallMissing", { id }),
        error: removed === 0,
      });
    } finally {
      setBusy(null);
    }
  };

  const refreshMarketplaceRow = async (row: ListRow) => {
    setBusy(row.key);
    try {
      await refreshMarketplace(row.name, createDefaultDeps(), {
        updatePlugins: false,
      });
      reloadCatalogs();
      bumpInstalled();
      setStatus({
        message: t("plugins.browser.refreshed", { name: row.name }),
      });
    } catch (error) {
      setStatus({
        message: (error as Error).message,
        error: true,
      });
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    status,
    errors,
    installAt,
    updateAt,
    toggleAt,
    uninstallAt,
    refreshMarketplaceRow,
  };
}
