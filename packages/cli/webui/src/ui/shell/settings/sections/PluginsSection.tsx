import type { PluginsResponse } from "../../../../api/client.js";
import { EmptyState } from "../shared.tsx";
import css from "../SettingsPage.module.css";

export interface PluginsSectionProps {
  plugins: PluginsResponse["plugins"];
  total: number;
  pluginsDir: string;
  disabledPlugins: string[];
  unknownEnabledPlugins: string[];
  busyPlugin: string | null;
  copiedPath: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onCopy: (target: string) => void;
  onOpen: (target: string) => void;
  onClear: () => void;
}

export function PluginsSection({
  plugins,
  total,
  pluginsDir,
  disabledPlugins,
  unknownEnabledPlugins,
  busyPlugin,
  copiedPath,
  onToggle,
  onCopy,
  onOpen,
  onClear,
}: PluginsSectionProps) {
  return (
    <div className={css.cards}>
      {unknownEnabledPlugins.length > 0 ? (
        <div className={css.warning}>
          Enabled but not installed: {unknownEnabledPlugins.join(", ")}
        </div>
      ) : null}
      {disabledPlugins.length > 0 &&
      plugins.every((plugin) => plugin.enabled) ? (
        <div className={css.hintBlock}>
          Disabled plugins are listed below. Enable one to load its skills,
          commands and agents into the next turn.
        </div>
      ) : null}
      {plugins.length === 0 ? (
        <EmptyState
          title={total === 0 ? "No plugins installed" : "No matching plugins"}
          body={
            total === 0
              ? "Install a plugin from the CLI with /plugins install <name>, then refresh this page."
              : "Try a different name or clear the search."
          }
          onAction={total === 0 ? () => onOpen(pluginsDir) : onClear}
          actionLabel={total === 0 ? "Open plugin folder" : "Clear search"}
        />
      ) : (
        plugins.map((plugin) => (
          <article
            key={plugin.id}
            className={css.card}
            data-enabled={plugin.enabled}
          >
            <div className={css.cardHeader}>
              <div className={css.cardTitleBlock}>
                <div className={css.cardTitleRow}>
                  <h3 className={css.cardTitle}>{plugin.name}</h3>
                  {plugin.id !== plugin.name ? (
                    <span className={css.pluginId}>{plugin.id}</span>
                  ) : null}
                  <span className={css.status} data-enabled={plugin.enabled}>
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className={css.cardDescription}>
                  {plugin.description ?? "No description provided."}
                </p>
              </div>
              <div className={css.cardActions}>
                <button
                  type="button"
                  className={css.primaryAction}
                  disabled={busyPlugin === plugin.name}
                  onClick={() => onToggle(plugin.name, !plugin.enabled)}
                >
                  {busyPlugin === plugin.name
                    ? "Saving..."
                    : plugin.enabled
                      ? "Disable"
                      : "Enable"}
                </button>
                <button
                  type="button"
                  className={css.secondaryAction}
                  onClick={() => onCopy(plugin.path)}
                >
                  {copiedPath === plugin.path ? "Copied" : "Copy path"}
                </button>
                <button
                  type="button"
                  className={css.secondaryAction}
                  onClick={() => onOpen(plugin.path)}
                >
                  Open folder
                </button>
              </div>
            </div>
            <div className={css.metaRow}>
              {plugin.version ? (
                <span className={css.meta}>v{plugin.version}</span>
              ) : null}
              <span className={css.meta}>{plugin.skills} skills</span>
              <span className={css.meta}>{plugin.commands} commands</span>
              <span className={css.meta}>{plugin.agents} agents</span>
              <span className={css.meta}>{plugin.mcpServers} MCP servers</span>
            </div>
            <div className={css.path} title={plugin.path}>
              {plugin.path}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
