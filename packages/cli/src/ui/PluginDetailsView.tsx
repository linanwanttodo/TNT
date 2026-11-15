import { Box, Text } from "ink";
import React from "react";

import { t } from "../i18n/index.js";
import type { MarketplacePluginEntry } from "../plugins/marketplaceTypes.js";

import {
  componentsFor,
  describeSource,
  detailStatusKind,
  hasComponents,
  statusColor,
  statusLabel,
  type DetailTarget,
  type InstalledEntry,
  type PluginComponents,
  type StatusKind,
} from "./pluginsBrowserModel.js";

interface PluginDetailsViewProps {
  target: DetailTarget;
  installed?: InstalledEntry;
  entry?: MarketplacePluginEntry;
  updateTo?: string;
  busy: string | null;
  error?: string;
  status: { message: string; error?: boolean } | null;
}

const PluginComponentsList: React.FC<{
  components: PluginComponents | null;
}> = ({ components }) => {
  if (components === null) {
    return (
      <Text dimColor>
        {"  "}
        {t("plugins.browser.componentsUnknown")}
      </Text>
    );
  }
  if (!hasComponents(components)) {
    return (
      <Text dimColor>
        {"  "}
        {t("plugins.browser.noComponents")}
      </Text>
    );
  }
  return (
    <>
      {components.commands.length > 0 && (
        <Text>
          {"  "}
          {t("plugins.browser.componentCommands", {
            list: components.commands.join(", "),
          })}
        </Text>
      )}
      {components.agents.length > 0 && (
        <Text>
          {"  "}
          {t("plugins.browser.componentAgents", {
            list: components.agents.join(", "),
          })}
        </Text>
      )}
      {components.skills.length > 0 && (
        <Text>
          {"  "}
          {t("plugins.browser.componentSkills", {
            list: components.skills.join(", "),
          })}
        </Text>
      )}
      {components.mcpServers.length > 0 && (
        <Text>
          {"  "}
          {t("plugins.browser.componentMcp", {
            list: components.mcpServers.join(", "),
          })}
        </Text>
      )}
    </>
  );
};

const PluginIdentity: React.FC<{
  target: DetailTarget;
  installed?: InstalledEntry;
  entry?: MarketplacePluginEntry;
  updateTo?: string;
  kind: StatusKind;
}> = ({ target, installed, entry, updateTo, kind }) => {
  const version = installed?.version ?? entry?.version;
  const author = entry?.author?.name ?? installed?.plugin.manifest.author?.name;
  const source = describeSource(entry?.source);
  const description = installed?.plugin.description ?? entry?.description ?? "";
  return (
    <>
      <Text bold>
        {target.name}
        {target.marketplace ? `@${target.marketplace}` : ""}
      </Text>
      <Text>
        {t("plugins.browser.version", {
          version: version ?? t("plugins.browser.unknown"),
        })}
      </Text>
      <Text color={statusColor(kind)}>
        {t("plugins.browser.detailsStatus", { status: statusLabel(kind) })}
      </Text>
      {description !== "" && <Text>{description}</Text>}
      {updateTo !== undefined && (
        <Text color="cyan">
          {t("plugins.browser.updateLine", {
            from: installed?.version ?? t("plugins.browser.unknown"),
            to: updateTo,
          })}
        </Text>
      )}
      <Text>
        {t("plugins.browser.author", {
          author: author ?? t("plugins.browser.unknown"),
        })}
      </Text>
      <Text>
        {t("plugins.browser.marketplace", {
          marketplace: target.marketplace || t("plugins.browser.unknown"),
        })}
      </Text>
      <Text>
        {t("plugins.browser.source", {
          source: source || t("plugins.browser.unknown"),
        })}
      </Text>
    </>
  );
};

function actionHints(
  installed: InstalledEntry | undefined,
  updateTo: string | undefined,
): string[] {
  const hints: string[] = [];
  if (installed === undefined) {
    hints.push(t("plugins.browser.actionInstall"));
  }
  if (updateTo !== undefined) {
    hints.push(t("plugins.browser.actionUpdate"));
  }
  if (installed !== undefined) {
    hints.push(
      installed.enabled
        ? t("plugins.browser.actionDisable")
        : t("plugins.browser.actionEnable"),
    );
    hints.push(t("plugins.browser.actionUninstall"));
  }
  hints.push(t("plugins.browser.actionBack"));
  return hints;
}

/**
 * One plugin's details: what it says about itself, what it will contribute,
 * and the actions available without leaving the view. The caller keeps the
 * operation state so a failed install or update stays on this screen.
 */
export const PluginDetailsView: React.FC<PluginDetailsViewProps> = ({
  target,
  installed,
  entry,
  updateTo,
  busy,
  error,
  status,
}) => {
  const id = installed?.plugin.id ?? `${target.name}@${target.marketplace}`;
  const components = installed ? componentsFor(installed.plugin) : null;
  const kind = detailStatusKind(installed, id, busy, error, updateTo);
  return (
    <Box flexDirection="column" paddingX={1}>
      <PluginIdentity
        target={target}
        installed={installed}
        entry={entry}
        updateTo={updateTo}
        kind={kind}
      />
      <Box height={1} />
      <Text dimColor>{t("plugins.browser.willInstall")}</Text>
      <PluginComponentsList components={components} />
      <Box height={1} />
      <Text color="gray" dimColor>
        {actionHints(installed, updateTo).join(" · ")}
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
