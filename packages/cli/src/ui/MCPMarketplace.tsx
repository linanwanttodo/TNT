import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { t } from "../i18n/index.js";
import {
  MCP_MARKETPLACE,
  installMarketplaceServer,
  installedMarketplaceNames,
  marketplaceConfigPath,
} from "../mcp/marketplace.js";

import { symbols } from "./symbols.js";

interface MCPMarketplaceProps {
  onCancel: () => void;
}

/**
 * `/mcp market`: a catalog of MCP servers written to mcp.json in the
 * compatible shape. Enter adds the highlighted server; a restart is
 * what connects it.
 */
export const MCPMarketplace: React.FC<MCPMarketplaceProps> = ({ onCancel }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [installed, setInstalled] = useState<Set<string>>(() =>
    installedMarketplaceNames(),
  );
  const [status, setStatus] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === "c")) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : MCP_MARKETPLACE.length - 1,
      );
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev + 1) % MCP_MARKETPLACE.length);
      return;
    }
    if (key.return) {
      const server = MCP_MARKETPLACE[selectedIndex];
      try {
        const path = installMarketplaceServer(server);
        setInstalled(installedMarketplaceNames());
        const envNote = server.envKeys?.length
          ? ` ${t("mcp.marketNeedsEnv", {
              keys: server.envKeys.join(", "),
              path,
            })}`
          : "";
        setStatus({
          message: t("mcp.marketAdded", { name: server.title, path }) + envNote,
        });
      } catch (error) {
        setStatus({
          message: t("mcp.marketFailed", {
            name: server.title,
            message: error instanceof Error ? error.message : String(error),
          }),
          error: true,
        });
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{t("mcp.marketTitle")}</Text>
      <Text dimColor>{marketplaceConfigPath()}</Text>
      <Box height={1} />
      {MCP_MARKETPLACE.map((server, index) => {
        const isSelected = index === selectedIndex;
        const isInstalled = installed.has(server.name);
        return (
          <Box key={server.name}>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? `${symbols().selected} ` : "  "}
              {server.title.padEnd(22)}
            </Text>
            <Text color={isSelected ? "cyan" : "gray"}>
              {server.description}
              {isInstalled ? ` · ${t("mcp.marketInstalled")}` : ""}
            </Text>
          </Box>
        );
      })}
      <Box height={1} />
      <Text color="gray" dimColor>
        {t("mcp.marketHint")}
      </Text>
      {status && (
        <Text color={status.error ? "red" : "green"}>{status.message}</Text>
      )}
    </Box>
  );
};
