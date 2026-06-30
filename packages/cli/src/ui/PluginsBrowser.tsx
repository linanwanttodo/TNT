import { Box, Text, useInput, type Key } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import { t } from "../i18n/index.js";
import {
  ensureDefaultMarketplace,
  type CatalogEntry,
} from "../plugins/discover.js";

import { PluginDetailsView } from "./PluginDetailsView.js";
import { usePluginActions } from "./pluginsBrowserActions.js";
import {
  discoverRowsFor,
  installedRowsFor,
  loadBrowserSnapshot,
  loadCatalogs,
  marketplaceRowsFor,
  statusColor,
  statusLabel,
  updateVersionFor,
  type DetailTarget,
  type ListRow,
  type StatusKind,
} from "./pluginsBrowserModel.js";
import { symbols } from "./symbols.js";

const TABS = ["installed", "discover", "marketplaces"] as const;
type Tab = (typeof TABS)[number];

/** Rows visible at once; the selection scrolls inside this window. */
const MAX_VISIBLE_ROWS = 10;

interface PluginsBrowserProps {
  onCancel: () => void;
}

function tabLabel(id: Tab): string {
  switch (id) {
    case "installed":
      return t("plugins.browser.tabInstalled");
    case "discover":
      return t("plugins.browser.tabDiscover");
    case "marketplaces":
      return t("plugins.browser.tabMarketplaces");
  }
}

function rowStatus(
  row: ListRow,
  busy: string | null,
  errors: Record<string, string>,
): StatusKind {
  if (busy === row.key) return "pending";
  if (errors[row.key] !== undefined) return "error";
  if (row.enabled === false) return "disabled";
  if (row.updateVersion !== undefined) return "update";
  return "enabled";
}

/**
 * `/plugins`: the inline plugin browser. Installed plugins, the registered
 * marketplaces' catalogs, and the marketplace list, with type-to-search,
 * per-plugin details and install/update/enable/disable/uninstall in place.
 */
export const PluginsBrowser: React.FC<PluginsBrowserProps> = ({ onCancel }) => {
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [catalogs, setCatalogs] = useState<CatalogEntry[] | null>(null);
  const [catalogFailures, setCatalogFailures] = useState<string[]>([]);
  const [catalogNote, setCatalogNote] = useState<string>(
    t("plugins.browser.loadingCatalog"),
  );
  const [installedVersion, setInstalledVersion] = useState(0);
  const [detail, setDetail] = useState<DetailTarget | null>(null);

  const reloadCatalogs = () => {
    const loaded = loadCatalogs();
    setCatalogs(loaded.catalogs);
    setCatalogFailures(loaded.failed);
  };

  const {
    busy,
    status,
    errors,
    installAt,
    updateAt,
    toggleAt,
    uninstallAt,
    refreshMarketplaceRow,
  } = usePluginActions({
    reloadCatalogs,
    bumpInstalled: () => setInstalledVersion((value) => value + 1),
  });

  useEffect(() => {
    let stale = false;
    void (async () => {
      const ensured = await ensureDefaultMarketplace();
      if (stale) return;
      if (ensured.message) setCatalogNote(ensured.message);
      const loaded = loadCatalogs();
      setCatalogs(loaded.catalogs);
      setCatalogFailures(loaded.failed);
    })();
    return () => {
      stale = true;
    };
  }, []);

  const snapshot = useMemo(() => {
    void installedVersion;
    return loadBrowserSnapshot();
  }, [installedVersion]);

  const installedRows = useMemo(
    () => installedRowsFor(snapshot, catalogs),
    [snapshot, catalogs],
  );

  const discoverRows = useMemo(
    () => discoverRowsFor(catalogs, query, snapshot),
    [catalogs, query, snapshot],
  );

  const marketplaceRows = useMemo(
    () => marketplaceRowsFor(catalogs),
    [catalogs, installedVersion],
  );

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

  const details = useMemo(() => {
    if (detail === null) return null;
    const id = `${detail.name}@${detail.marketplace}`;
    const installed =
      snapshot.all.find((candidate) => candidate.plugin.id === id) ??
      (detail.marketplace === ""
        ? snapshot.all.find(
            (candidate) => candidate.plugin.name === detail.name,
          )
        : undefined);
    const entry = catalogs
      ?.find((catalog) => catalog.marketplace === detail.marketplace)
      ?.plugins.find((plugin) => plugin.name === detail.name);
    return {
      installed,
      entry,
      updateTo: updateVersionFor(installed, entry),
    };
  }, [detail, snapshot, catalogs]);

  const cycleTab = (delta: number) => {
    setTab(
      (prev) => TABS[(TABS.indexOf(prev) + delta + TABS.length) % TABS.length],
    );
    setSelected(0);
  };

  const handleDetailKey = (input: string, key: Key) => {
    if (detail === null) return;
    if (key.escape || input === "b") {
      setDetail(null);
      return;
    }
    if (key.ctrl && input === "c") {
      onCancel();
      return;
    }
    if (busy !== null) return;
    const installed = details?.installed;
    const updateTo = details?.updateTo;
    const id = installed?.plugin.id ?? `${detail.name}@${detail.marketplace}`;
    if (input === "i" && installed === undefined) {
      void installAt(detail.name, detail.marketplace);
      return;
    }
    if (input === "u" && installed !== undefined && updateTo !== undefined) {
      void updateAt(detail.name, detail.marketplace);
      return;
    }
    if (input === "e" && installed !== undefined) {
      toggleAt(id, installed.enabled);
      return;
    }
    if ((input === "d" || input === "x") && installed !== undefined) {
      uninstallAt(id);
      return;
    }
    if (key.return) {
      if (installed === undefined) {
        void installAt(detail.name, detail.marketplace);
      } else if (updateTo !== undefined) {
        void updateAt(detail.name, detail.marketplace);
      }
    }
  };

  const handleListKey = (input: string, key: Key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }
    // Left/right switch tabs the way the reference panel does; Tab cycles.
    if (key.leftArrow) {
      cycleTab(-1);
      return;
    }
    if (key.rightArrow) {
      cycleTab(1);
      return;
    }
    if (key.tab) {
      cycleTab(1);
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
      const row = rows[selected];
      if (row === undefined) return;
      if (tab === "marketplaces") {
        void refreshMarketplaceRow(row);
      } else {
        setDetail({ name: row.name, marketplace: row.marketplace });
      }
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
  };

  useInput((input, key) => {
    if (detail !== null) {
      handleDetailKey(input, key);
      return;
    }
    handleListKey(input, key);
  });

  if (detail !== null) {
    return (
      <PluginDetailsView
        target={detail}
        installed={details?.installed}
        entry={details?.entry}
        updateTo={details?.updateTo}
        busy={busy}
        error={
          details?.installed ? errors[details.installed.plugin.id] : undefined
        }
        status={status}
      />
    );
  }

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
      {catalogFailures.length > 0 && (
        <Text color="yellow">
          {t("plugins.browser.catalogWarning", {
            names: catalogFailures.join(", "),
          })}
        </Text>
      )}
      {tab === "installed" && snapshot.unknownEnabled.length > 0 && (
        <Text color="yellow">
          {t("plugins.browser.unknownEnabledWarning", {
            names: snapshot.unknownEnabled.join(", "),
          })}
        </Text>
      )}
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
        const kind = tab === "installed" ? rowStatus(row, busy, errors) : null;
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
            {kind !== null && (
              <Text color={statusColor(kind)}> [{statusLabel(kind)}]</Text>
            )}
          </Box>
        );
      })}

      <Box height={1} />
      <Text color="gray" dimColor>
        {rows.length > 0
          ? `${t("plugins.browser.hints")} (${Math.min(selected + 1, rows.length)}/${rows.length})`
          : t("plugins.browser.hints")}
      </Text>
      {busy !== null && (
        <Text dimColor>{t("plugins.browser.busy", { id: busy })}</Text>
      )}
      {status !== null && (
        <Text color={status.error ? "red" : "green"}>{status.message}</Text>
      )}
    </Box>
  );
};
