import { Box, Text } from "ink";
import React from "react";

import { logger } from "src/utils/logger.js";

import { t } from "../../i18n/index.js";
import {
  listSessions,
  listSubagentSessions,
  type ExtendedSessionMetadata,
} from "../../session/index.js";
import { SessionSelector } from "../SessionSelector.js";

interface SessionSelectorWithLoadingProps {
  onSelect: (sessionId: string) => Promise<void>;
  onExit: () => void;
  /**
   * Which list to show. "subagents" narrows the list to runs delegated from
   * parentSessionId instead of the top-level sessions.
   */
  source?: "sessions" | "subagents";
  parentSessionId?: string;
}

export const SessionSelectorWithLoading: React.FC<
  SessionSelectorWithLoadingProps
> = ({ onSelect, onExit, source = "sessions", parentSessionId }) => {
  const [sessions, setSessions] = React.useState<ExtendedSessionMetadata[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let isMounted = true;

    const loadSessions = async () => {
      try {
        if (!isMounted) return;
        setIsLoading(true);
        const sessionList =
          source === "subagents"
            ? listSubagentSessions(parentSessionId ?? "")
            : await listSessions();
        if (!isMounted) return;
        setSessions(sessionList);
      } catch (error) {
        if (!isMounted) return;
        logger.error("Error loading sessions:", error);
        setSessions([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadSessions();

    return () => {
      isMounted = false;
    };
  }, [source, parentSessionId]);

  if (isLoading) {
    return (
      <Box paddingX={1} borderStyle="round" borderColor="blue">
        <Text color="blue">
          {source === "subagents"
            ? t("subagent.loading")
            : t("session.loading")}
        </Text>
      </Box>
    );
  }

  return (
    <SessionSelector
      sessions={sessions}
      onSelect={onSelect}
      onExit={onExit}
      title={source === "subagents" ? t("subagent.selectorTitle") : undefined}
    />
  );
};
