import React, { useEffect, useRef, useState } from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import type { MCPServiceState } from "../../services/types.js";
import { bashToolEvents } from "../../utils/cli.js";
import { collectFailedMcpServerNames } from "../utils/mcpFailures.js";

/** Tracks whether a Bash tool is currently running, for the status hint. */
export function useBashToolRunning(): boolean {
  const [isBashToolRunning, setIsBashToolRunning] = useState(false);

  useEffect(() => {
    const handleStarted = () => setIsBashToolRunning(true);
    const handleEnded = () => setIsBashToolRunning(false);

    bashToolEvents.on("started", handleStarted);
    bashToolEvents.on("ended", handleEnded);

    return () => {
      bashToolEvents.off("started", handleStarted);
      bashToolEvents.off("ended", handleEnded);
    };
  }, []);

  return isBashToolRunning;
}

/**
 * MCP servers connect in the background, so a failure lands after the
 * transcript has started. Report it once, in the transcript, rather than in
 * the startup banner that is already on screen.
 */
export function useMcpFailureNotice(
  mcp: MCPServiceState | undefined,
  setChatHistory: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>,
): void {
  const reported = useRef(false);

  useEffect(() => {
    const names = collectFailedMcpServerNames(mcp?.connections);
    if (names.length === 0 || reported.current) return;
    reported.current = true;

    setChatHistory((prev) => [
      ...prev,
      {
        message: {
          role: "system",
          content: `${t("mcp.failed", { servers: names.join(", ") })}\n${t("mcp.failedHint")}`,
        },
        contextItems: [],
      },
    ]);
  }, [mcp?.connections, setChatHistory]);
}

/** Labels a delegated transcript so the composer can be locked and titled. */
export function useSubagentView(
  session: { parentSessionId?: string; subagentType?: string } | null,
): {
  parentSessionId: string;
  subagentType: string;
} | null {
  const parentSessionId = session?.parentSessionId;
  if (!parentSessionId) return null;
  return {
    parentSessionId,
    subagentType: session?.subagentType ?? t("subagent.unlabeled"),
  };
}
