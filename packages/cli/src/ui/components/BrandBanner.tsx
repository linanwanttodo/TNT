import { Box, Text } from "ink";
import React from "react";

import { SERVICE_NAMES } from "../../services/types.js";
import type { ModelServiceState } from "../../services/types.js";
import { getCurrentSession } from "../../session/index.js";
import { getDisplayableAsciiArt } from "../../startup/asciiArt.js";
import { useServices } from "../hooks/useService.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { hyperlink } from "../hyperlink.js";
import { useTheme } from "../theme/tokens.js";

import { getThinkingDepth } from "./BottomStatusBar.js";

/**
 * The intro header, laid out like the reference CLIs: a rounded frame holding
 * the wordmark, a greeting, and the session facts the reader asks for first -
 * directory, model, version - plus the repository as a clickable link.
 * Static on purpose.
 */
const LOGO_ROWS = [
  "███████  ██   ██  ███████",
  " █████   ███  ██   █████ ",
  "  ███    ██ █ ██    ███  ",
  "  ███    ██  ███    ███  ",
];

const BRAND_BLUE = "#7dd3fc";
const REPO_URL = "https://github.com/linanwanttodo/TNT";

interface BrandBannerProps {
  version: string;
}

function field(label: string, value: React.ReactNode): React.ReactNode {
  return (
    <Box>
      <Text color="gray">{`${label}:`.padEnd(11)}</Text>
      {value}
    </Box>
  );
}

export const BrandBanner: React.FC<BrandBannerProps> = ({ version }) => {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const model = useServices<{ model: ModelServiceState }>([SERVICE_NAMES.MODEL])
    .services.model?.model;

  let sessionId = "";
  let sessionTitle = "";
  let workspace = "";
  try {
    const session = getCurrentSession();
    sessionId = session.sessionId;
    sessionTitle = session.title;
    workspace = session.workspaceDirectory || process.cwd();
  } catch {
    // An uninitialized process shows the frame without the session facts.
  }

  const modelName = model?.name || model?.model || "—";
  const thinking = getThinkingDepth(model);
  const repoLabel = hyperlink("linanwanttodo/TNT", REPO_URL);

  if (columns < 60 || process.env.NO_COLOR) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={1}
        marginTop={1}
        marginBottom={1}
      >
        <Text>{getDisplayableAsciiArt()}</Text>
        <Text>TNT CLI v{version}</Text>
        <Text color="gray">{repoLabel}</Text>
      </Box>
    );
  }

  // Shortcut hints live in the right pane, separated from the facts by a
  // vertical rule. The rule spans the taller pane, so the count is fixed to
  // the left column's height.
  const hints = [
    "/ 命令 · @ 引用 · ! shell",
    "esc 中断 · 双 esc 编辑",
    "ctrl+o 折叠 · ctrl+p 面板",
    "shift+tab 切换模式",
    "点击消息回到输入框编辑",
  ];
  const leftRows = LOGO_ROWS.length + 2 + 1 + 5;

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.focus}
      paddingX={1}
      marginTop={1}
      marginBottom={1}
    >
      <Box flexDirection="row" width="100%">
        <Box flexShrink={1} flexDirection="column">
          <Box flexDirection="row">
            <Box flexShrink={0} flexDirection="column" marginRight={2}>
              {LOGO_ROWS.map((row, index) => (
                <Text key={index} color={BRAND_BLUE}>
                  {row}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column" justifyContent="center">
              <Text bold>Welcome to TNT CLI!</Text>
              <Text color="gray">Send /help for help information.</Text>
            </Box>
          </Box>
          <Box marginTop={1} flexDirection="column">
            {field("Directory", <Text>{workspace}</Text>)}
            {field(
              "Session",
              <Text wrap="truncate-end">
                {sessionTitle || sessionId.slice(0, 8)}
              </Text>,
            )}
            {field(
              "Model",
              <Text>
                {modelName}
                {thinking ? ` · ${thinking}` : ""}
              </Text>,
            )}
            {field("Version", <Text>v{version}</Text>)}
            {field("GitHub", <Text>{repoLabel}</Text>)}
          </Box>
        </Box>
        <Box width={1} flexShrink={0} flexDirection="column">
          {/* The rule stops short of the frame's top and bottom lines; a
              divider that runs corner to corner reads as a second border. */}
          {Array.from({ length: Math.max(0, leftRows - 2) }).map((_, index) => (
            <Text key={index} color="gray" dimColor>
              {index === 0 ? " " : "│"}
            </Text>
          ))}
        </Box>
        <Box flexGrow={1} flexDirection="column" paddingLeft={1}>
          {hints.map((hint) => (
            <Text key={hint} color="gray" dimColor>
              {hint}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
};
