import { useCallback, useEffect, useState } from "react";

import {
  fetchMarketplaces,
  installMarketplacePlugin,
  refreshMarketplaceApi,
  type MarketplacesResponse,
} from "../../../api/client.js";
import { useUiPreferences } from "../../../stores/ui-preferences.js";
import css from "./SettingsPage.module.css";

/**
 * The plugin marketplace, in the shell's settings visual language: one
 * section per registered marketplace, plugin cards with install state, and
 * a refresh per catalogue. Everything talks to the real marketplace backend.
 */
export function MarketplacePage() {
  const language = useUiPreferences((state) => state.language);
  const [data, setData] = useState<MarketplacesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchMarketplaces());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(
    async (name: string) => {
      setBusy(`refresh:${name}`);
      setNotice(null);
      try {
        setData(await refreshMarketplaceApi(name));
        setNotice(
          language === "zh" ? `已刷新 ${name}。` : `Refreshed ${name}.`,
        );
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [language],
  );

  const install = useCallback(
    async (marketplace: string, plugin: string) => {
      setBusy(`install:${marketplace}:${plugin}`);
      setNotice(null);
      try {
        setData(await installMarketplacePlugin(marketplace, plugin));
        setNotice(
          language === "zh" ? `已安装 ${plugin}。` : `Installed ${plugin}.`,
        );
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [language],
  );

  const refreshLabel = language === "zh" ? "刷新" : "Refresh";
  const installLabel = language === "zh" ? "安装" : "Install";
  const installedLabel = language === "zh" ? "已安装" : "Installed";
  const emptyLabel =
    language === "zh"
      ? "没有注册的市场。用 /plugin marketplace add <source> 在 CLI 里添加。"
      : "No marketplaces registered. Add one with /plugin marketplace add <source> in the CLI.";

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.heading}>
          <h1 className={css.title}>
            {language === "zh" ? "插件市场" : "Plugin marketplace"}
          </h1>
          <p className={css.subtitle}>
            {language === "zh"
              ? "浏览已注册市场的插件，安装后立即生效。"
              : "Browse the registered marketplaces' plugins; installs land immediately."}
          </p>
        </div>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.secondaryAction}
            onClick={() => void load()}
          >
            {language === "zh" ? "刷新全部" : "Refresh all"}
          </button>
        </div>
      </header>
      <main className={css.panel}>
        {notice ? (
          <div className={css.notice} role="status">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className={css.error} role="alert">
            {error}
          </div>
        ) : null}
        {data === null && !error ? (
          <div className={css.loading}>
            {language === "zh" ? "加载中..." : "Loading..."}
          </div>
        ) : null}
        {data !== null && data.marketplaces.length === 0 ? (
          <div className={css.empty}>
            <h3 className={css.emptyTitle}>
              {language === "zh" ? "没有市场" : "No marketplaces"}
            </h3>
            <p className={css.emptyBody}>{emptyLabel}</p>
          </div>
        ) : null}
        {data?.marketplaces.map((marketplace) => (
          <section key={marketplace.name} className={css.marketplace}>
            <div className={css.marketplaceHead}>
              <h2 className={css.marketplaceName}>{marketplace.name}</h2>
              {marketplace.lastUpdated ? (
                <span className={css.marketplaceUpdated}>
                  {new Date(marketplace.lastUpdated).toLocaleString()}
                </span>
              ) : null}
              <span className={css.modelFormSpacer} />
              <button
                type="button"
                className={css.secondaryAction}
                disabled={busy === `refresh:${marketplace.name}`}
                onClick={() => void refresh(marketplace.name)}
              >
                {busy === `refresh:${marketplace.name}`
                  ? language === "zh"
                    ? "刷新中..."
                    : "Refreshing..."
                  : refreshLabel}
              </button>
            </div>
            {marketplace.plugins.length === 0 ? (
              <div className={css.muted}>
                {language === "zh"
                  ? "目录为空或尚未拉取，点刷新试试。"
                  : "The catalogue is empty or not fetched yet; try refreshing."}
              </div>
            ) : (
              <div className={css.cards}>
                {marketplace.plugins.map((plugin) => (
                  <div
                    key={plugin.name}
                    className={css.card}
                    data-enabled={plugin.installed}
                  >
                    <div className={css.cardHeader}>
                      <div className={css.cardTitleBlock}>
                        <div className={css.cardTitleRow}>
                          <h3 className={css.cardTitle}>{plugin.name}</h3>
                          {plugin.version ? (
                            <span className={css.pluginId}>
                              v{plugin.version}
                            </span>
                          ) : null}
                          {plugin.installed ? (
                            <span className={css.status} data-enabled="true">
                              {installedLabel}
                            </span>
                          ) : null}
                        </div>
                        {plugin.description ? (
                          <p className={css.cardDescription}>
                            {plugin.description}
                          </p>
                        ) : null}
                        <div className={css.metaRow}>
                          {plugin.category ? (
                            <span className={css.meta}>{plugin.category}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className={css.cardActions}>
                        {plugin.installed ? null : (
                          <button
                            type="button"
                            className={css.primaryAction}
                            disabled={
                              busy ===
                              `install:${marketplace.name}:${plugin.name}`
                            }
                            onClick={() =>
                              void install(marketplace.name, plugin.name)
                            }
                          >
                            {busy ===
                            `install:${marketplace.name}:${plugin.name}`
                              ? language === "zh"
                                ? "安装中..."
                                : "Installing..."
                              : installLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
