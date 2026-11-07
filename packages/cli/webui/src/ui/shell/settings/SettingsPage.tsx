import { useEffect, useMemo, useState } from "react";

import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { sectionText, shellCopy } from "../ui-copy.ts";
import { mcpLabel } from "./shared.tsx";
import { AppearanceSection } from "./sections/AppearanceSection.tsx";
import { ContributionsSection } from "./sections/ContributionsSection.tsx";
import { GeneralSection } from "./sections/GeneralSection.tsx";
import { McpSection } from "./sections/McpSection.tsx";
import { ModelsSection } from "./sections/ModelsSection.tsx";
import { PluginsSection } from "./sections/PluginsSection.tsx";
import {
  isListSection,
  SETTINGS_SECTIONS,
  type ListSectionId,
  type SettingsSectionId,
} from "./types.ts";
import { useSettingsData } from "./useSettingsData.ts";
import css from "./SettingsPage.module.css";

export interface SettingsPageProps {
  section: SettingsSectionId;
}

/**
 * The Settings page. Each section lives in its own component; this file owns
 * only the page chrome, search/filter projection and the section switch.
 */
export function SettingsPage({ section }: SettingsPageProps) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  const data = useSettingsData();
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery("");
  }, [section]);

  const activeDefinition =
    SETTINGS_SECTIONS.find((candidate) => candidate.id === section) ??
    SETTINGS_SECTIONS[0]!;
  const activeText = sectionText(copy, activeDefinition.id);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (...values: Array<string | undefined>): boolean =>
    normalizedQuery === "" ||
    values.some((value) =>
      (value ?? "").toLowerCase().includes(normalizedQuery),
    );

  const visiblePlugins = useMemo(
    () =>
      (data.plugins?.plugins ?? []).filter((plugin) =>
        matches(plugin.name, plugin.id, plugin.description),
      ),
    [data.plugins, normalizedQuery],
  );
  const visibleSkills = useMemo(
    () =>
      (data.plugins?.skills ?? []).filter((skill) =>
        matches(skill.name, skill.description, skill.plugin),
      ),
    [data.plugins, normalizedQuery],
  );
  const visibleCommands = useMemo(
    () =>
      (data.plugins?.commands ?? []).filter((command) =>
        matches(command.name, command.description, command.plugin),
      ),
    [data.plugins, normalizedQuery],
  );
  const visibleAgents = useMemo(
    () =>
      (data.plugins?.agents ?? []).filter((agent) =>
        matches(agent.name, agent.description, agent.plugin),
      ),
    [data.plugins, normalizedQuery],
  );
  const visibleMcp = useMemo(
    () =>
      Object.entries(data.plugins?.mcpServers ?? {}).filter(([name, value]) =>
        matches(name, mcpLabel(value)),
      ),
    [data.plugins, normalizedQuery],
  );

  const counts: Record<ListSectionId, number> = {
    plugins: data.plugins?.plugins.length ?? 0,
    skills: data.plugins?.skills.length ?? 0,
    commands: data.plugins?.commands.length ?? 0,
    agents: data.plugins?.agents.length ?? 0,
    mcp: Object.keys(data.plugins?.mcpServers ?? {}).length,
  };
  const listSection = isListSection(section) ? section : null;
  const totalCount = listSection === null ? 0 : counts[listSection];
  const visibleCount =
    listSection === "plugins"
      ? visiblePlugins.length
      : listSection === "skills"
        ? visibleSkills.length
        : listSection === "commands"
          ? visibleCommands.length
          : listSection === "agents"
            ? visibleAgents.length
            : listSection === "mcp"
              ? visibleMcp.length
              : 0;

  const workspaceDirectory =
    (data.state?.session as { workspaceDirectory?: string } | undefined)
      ?.workspaceDirectory ?? "";
  const sessionTitle = data.state?.session.title ?? "";
  const permissionMode =
    (data.state as { permissionMode?: string } | null)?.permissionMode ?? "";
  const currentModelName =
    data.models?.current?.name ??
    (data.state?.session as { chatModelTitle?: string } | undefined)
      ?.chatModelTitle ??
    "";

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.heading}>
          <h1 className={css.title}>{activeText.label}</h1>
          <p className={css.subtitle}>{activeText.description}</p>
        </div>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.secondaryAction}
            onClick={data.reload}
            disabled={data.loading}
          >
            {data.loading ? "Refreshing..." : "Refresh"}
          </button>
          {data.plugins && listSection !== null ? (
            <button
              type="button"
              className={css.secondaryAction}
              onClick={() =>
                data.plugins && data.revealPath(data.plugins.pluginsDir)
              }
            >
              Open plugin folder
            </button>
          ) : null}
        </div>
      </header>

      <main className={css.panel}>
        {listSection !== null ? (
          <div className={css.toolbar}>
            <input
              type="search"
              className={css.search}
              value={query}
              placeholder={`Search ${activeText.label.toLowerCase()}`}
              aria-label={`Search ${activeText.label}`}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className={css.resultCount}>
              {visibleCount} of {totalCount}
            </span>
            {query.trim() !== "" ? (
              <button
                type="button"
                className={css.clearSearch}
                onClick={() => setQuery("")}
              >
                Clear search
              </button>
            ) : null}
          </div>
        ) : null}

        {data.notice ? (
          <div className={css.notice} role="status">
            {data.notice}
          </div>
        ) : null}
        {data.error ? (
          <div className={css.error} role="alert">
            <span>{data.error}</span>
            <button type="button" onClick={data.reload}>
              Retry
            </button>
          </div>
        ) : null}

        {data.plugins === null && data.loading ? (
          <div className={css.loading} aria-busy="true">
            Loading settings...
          </div>
        ) : null}

        {section === "general" ? (
          <GeneralSection
            workspace={workspaceDirectory}
            sessionTitle={sessionTitle}
            model={currentModelName}
            permissionMode={permissionMode}
            queueLength={data.state?.messageQueueLength ?? 0}
            isProcessing={data.state?.isProcessing ?? false}
            settingsPath={data.plugins?.settingsPath ?? ""}
            pluginsDir={data.plugins?.pluginsDir ?? ""}
            copiedPath={data.copiedPath}
            onOpen={data.revealPath}
            onCopy={data.copyPath}
          />
        ) : null}

        {section === "models" ? (
          <ModelsSection
            models={data.models}
            onUse={(index) => void data.selectModel(index)}
            onRetry={data.reload}
            onSave={(input, editName) => data.saveModel(input, editName)}
            onDelete={(name) => data.removeModel(name)}
            onReorder={(names) => data.reorderDeclaredModels(names)}
            onTest={(input) => data.testModelConnection(input)}
          />
        ) : null}

        {section === "appearance" ? <AppearanceSection /> : null}

        {section === "plugins" && data.plugins ? (
          <PluginsSection
            plugins={visiblePlugins}
            total={counts.plugins}
            pluginsDir={data.plugins.pluginsDir}
            disabledPlugins={data.plugins.disabledPlugins}
            unknownEnabledPlugins={data.plugins.unknownEnabledPlugins}
            busyPlugin={data.busyPlugin}
            copiedPath={data.copiedPath}
            onToggle={(name, enabled) => void data.togglePlugin(name, enabled)}
            onCopy={data.copyPath}
            onOpen={data.revealPath}
            onClear={() => setQuery("")}
          />
        ) : null}

        {section === "skills" && data.plugins ? (
          <ContributionsSection
            kind="skills"
            items={visibleSkills}
            total={counts.skills}
            onClear={() => setQuery("")}
          />
        ) : null}

        {section === "commands" && data.plugins ? (
          <ContributionsSection
            kind="commands"
            items={visibleCommands}
            total={counts.commands}
            onClear={() => setQuery("")}
          />
        ) : null}

        {section === "agents" && data.plugins ? (
          <ContributionsSection
            kind="agents"
            items={visibleAgents}
            total={counts.agents}
            onClear={() => setQuery("")}
          />
        ) : null}

        {section === "mcp" && data.plugins ? (
          <McpSection
            entries={visibleMcp}
            total={counts.mcp}
            onClear={() => setQuery("")}
          />
        ) : null}

        {data.plugins && listSection !== null ? (
          <footer className={css.footer}>
            Enablement is saved to <code>{data.plugins.settingsPath}</code>.
            Install or remove plugins from the CLI with{" "}
            <code>/plugins install</code> and <code>/plugins uninstall</code>.
            {data.plugins.marketplaces.length > 0
              ? ` Registered marketplaces: ${data.plugins.marketplaces.join(", ")}.`
              : ""}
          </footer>
        ) : null}
      </main>
    </div>
  );
}
