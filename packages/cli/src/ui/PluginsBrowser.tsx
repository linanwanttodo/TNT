import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import { t } from "../i18n/index.js";
import {
  CatalogEntry,
  ensureDefaultMarketplace,
  loadMarketplaceCatalogs,
  searchCatalogPlugins,
} from "../plugins/discover.js";
import { loadAllPlugins } from "../plugins/loader.js";
import {
  refreshMarketplace,
  createDefaultDeps,
} from "../plugins/marketplaceManager.js";
import { loadKnownMarketplaces } from "../plugins/marketplaceRegistry.js";
import {
  installPluginWithDependencies,
  uninstallPlugin,
} from "../plugins/pluginInstall.js";

import { symbols } from "./symbols.js";

const TABS = ["installed", "discover", "marketplaces"] as const;
type Tab = (typeof TABS)[number];

/** Rows visible at once; the selection scrolls inside this window. */
const MAX_VISIBLE_ROWS = 10;

interface ListRow {
  key: string;
  name: string;
  marketplace: string;
  detail: string;
  installed: boolean;
}

interface PluginsBrowserProps {
  onCancel: () => void;
}

/**
 * `/plugins`: the inline plugin browser. Installed plugins, the registered
 * marketplaces' catalogs, and the marketplace list, with type-to-search and
 * install/uninstall in place - the flow the reference client offers.
 */
export const PluginsBrowser: React.FC<PluginsBrowserProps> = ({ onCancel }) => {
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [catalogs, setCatalogs] = useState<CatalogEntry[] | null>(null);
  const [catalogNote, setCatalogNote] = useState<string>(
    t("plugins.browser.loadingCatalog"),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [installedVersion, setInstalledVersion] = useState(0);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const ensured = await ensureDefaultMarketplace();
      if (stale) return;
      if (ensured.message) setCatalogNote(ensured.message);
      setCatalogs(loadMarketplaceCatalogs());
    })();
    return () => {
      stale = true;
    };
  }, []);

  const installedRows = useMemo<ListRow[]>(() => {
    void installedVersion;
    const result = loadAllPlugins();
    return result.plugins.map((plugin) => {
      const at = plugin.id.lastIndexOf("@");
      const marketplace = at > 0 ? plugin.id.slice(at + 1) : "";
      return {
        key: plugin.id,
        name: plugin.name,
        marketplace,
        detail: plugin.description ?? "",
        installed: true,
      };
    });
  }, [installedVersion]);

  const discoverRows = useMemo<ListRow[]>(() => {
    if (catalogs === null) return [];
    return searchCatalogPlugins(catalogs, query).map((match) => ({
      key: `${match.plugin.name}@${match.marketplace}`,
      name: match.plugin.name,
      marketplace: match.marketplace,
      detail: match.plugin.description ?? "",
      installed: installedRows.some(
        (row) =>
          row.key === match.plugin.name || row.name === match.plugin.name,
      ),
    }));
  }, [catalogs, query, installedRows]);

  const marketplaceRows = useMemo<ListRow[]>(() => {
    const known = loadKnownMarketplaces();
    return Object.keys(known)
      .sort()
      .map((name) => {
        const count = catalogs?.find((c) => c.marketplace === name)?.plugins
          .length;
        return {
          key: name,
          name,
          marketplace: "",
          detail:
            count === undefined
              ? t("plugins.browser.marketplaceUnknownCount")
              : t("plugins.browser.marketplaceCount", { count }),
          installed: false,
        };
      });
  }, [catalogs, installedVersion]);

  const rows = useMemo<ListRow[]>(() => {
    const source =
      tab === "installed"
        ? installedRows
        : tab === "discover"
          ? discoverRows
          : marketplaceRows;
    const needle = query.trim().toLowerCase();
    if (needle === "" || tab === "discover") return source;
    return source.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.detail.toLowerCase().includes(needle),
    );
  }, [tab, installedRows, discoverRows, marketplaceRows, query]);

  useEffect(() => {
    setSelected((prev) => Math.min(prev, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const windowStart = Math.max(
    0,
    Math.min(selected - (MAX_VISIBLE_ROWS - 1), rows.length - MAX_VISIBLE_ROWS),
  );
  const visibleRows = rows.slice(windowStart, windowStart + MAX_VISIBLE_ROWS);

  const runAction = async () => {
    const row = rows[selected];
    if (!row || busy) return;
    if (tab === "installed") {
      setBusy(row.key);
      try {
        const removed = uninstallPlugin(row.key);
        setStatus({
          message: removed
            ? t("plugin.uninstallDone", { id: row.key })
            : t("plugin.uninstallMissing", { id: row.key }),
          error: !removed,
        });
        setInstalledVersion((v) => v + 1);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (tab === "discover") {
      setBusy(row.key);
      setStatus({ message: t("plugins.browser.installing", { id: row.key }) });
      try {
        await installPluginWithDependencies(
          row.marketplace,
          row.name,
          createDefaultDeps(),
        );
        setStatus({
          message: t("plugin.installed", { id: row.key, version: "" }),
        });
        setInstalledVersion((v) => v + 1);
      } catch (error) {
        setStatus({
          message: t("plugin.installFailed", {
            reference: row.key,
            message: (error as Error).message,
          }),
          error: true,
        });
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy(row.key);
    try {
      await refreshMarketplace(row.name, createDefaultDeps(), {
        updatePlugins: false,
      });
      setCatalogs(loadMarketplaceCatalogs());
      setInstalledVersion((v) => v + 1);
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

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }
    // Left/right switch tabs the way the reference panel does; Tab cycles.
    if (key.leftArrow) {
      setTab(
        (prev) => TABS[(TABS.indexOf(prev) + TABS.length - 1) % TABS.length],
      );
      setSelected(0);
      return;
    }
    if (key.rightArrow) {
      setTab((prev) => TABS[(TABS.indexOf(prev) + 1) % TABS.length]);
      setSelected(0);
      return;
    }
    if (key.tab) {
      setTab((prev) => TABS[(TABS.indexOf(prev) + 1) % TABS.length]);
      setSelected(0);
      return;
    }
    if (key.upArrow) {
      setSelected((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (key.downArrow) {
      setSelected((prev) => Math.min(prev + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (key.return) {
      void runAction();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((prev) => Array.from(prev).slice(0, -1).join(""));
      return;
    }
    if (!key.ctrl && !key.meta && input && input.trim() !== "") {
      setQuery((prev) => prev + input);
      setSelected(0);
    }
  });

  const tabLabel = (id: Tab) => {
    const labels: Record<Tab, string> = {
      installed: t("plugins.browser.tabInstalled"),
      discover: t("plugins.browser.tabDiscover"),
      marketplaces: t("plugins.browser.tabMarketplaces"),
    };
    return labels[id];
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2}>
        {TABS.map((id) => (
          <Text
            key={id}
            bold={id === tab}
            color={id === tab ? "cyan" : undefined}
          >
            {id === tab ? `[${tabLabel(id)}]` : tabLabel(id)}
          </Text>
        ))}
      </Box>
      <Box height={1} />
      <Text dimColor>
        {t("plugins.browser.searchLabel")}
        {query}
        {"_"}
      </Text>
      <Box height={1} />

      {tab === "discover" && catalogs === null && (
        <Text dimColor>{catalogNote}</Text>
      )}

      {rows.length === 0 && catalogs !== null && (
        <Text dimColor>{t("plugins.browser.noMatches")}</Text>
      )}

      {visibleRows.map((row, index) => {
        const isSelected = windowStart + index === selected;
        const mark = row.installed ? symbols().check : " ";
        return (
          <Box key={row.key}>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? "› " : "  "}
              {mark} {row.name.padEnd(24)}
            </Text>
            <Text color={isSelected ? "cyan" : "gray"}>
              {row.marketplace && `${row.marketplace} · `}
              {row.detail}
            </Text>
          </Box>
        );
      })}

      <Box height={1} />
      <Text color="gray" dimColor>
        {rows.length > 0
          ? `${t("plugins.browser.hints")} (${Math.min(selected + 1, rows.length)}/${rows.length})`
          : t("plugins.browser.hints")}
      </Text>
      {busy && <Text dimColor>{t("plugins.browser.busy", { id: busy })}</Text>}
      {status && (
        <Text color={status.error ? "red" : "green"}>{status.message}</Text>
      )}
    </Box>
  );
};
