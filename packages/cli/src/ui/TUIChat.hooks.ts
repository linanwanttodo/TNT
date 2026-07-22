import React, { useCallback, useMemo, useRef } from "react";

import { fireConfigChange } from "../hooks/fireHook.js";
import { ToolPermissionServiceState } from "../services/ToolPermissionService.js";
import {
  ApiClientServiceState,
  ConfigServiceState,
  MCPServiceState,
  ModelServiceState,
  UpdateServiceState,
} from "../services/types.js";
import { liveHub } from "../webuiZcode/liveHub.js";

import { useServices } from "./hooks/useService.js";

interface UseTUIChatServicesResult {
  services: {
    config?: ConfigServiceState;
    model?: ModelServiceState;
    mcp?: MCPServiceState;
    apiClient?: ApiClientServiceState;
    update?: UpdateServiceState;
    toolPermissions?: ToolPermissionServiceState;
  };
  allServicesReady: boolean;
  isRemoteMode: boolean;
}

export function useTUIChatServices(
  remoteUrl?: string,
): UseTUIChatServicesResult {
  const isRemoteMode = useMemo(() => !!remoteUrl, [remoteUrl]);

  const { services, allReady: allServicesReady } = useServices<
    UseTUIChatServicesResult["services"]
  >(["config", "model", "mcp", "apiClient", "update", "toolPermissions"]);

  return { services, allServicesReady, isRemoteMode };
}

/**
 * `/clear` and config reload live here: both reset what the screen shows, and
 * both must reach whatever turn is running through the same handlers the
 * slash commands use.
 */
export function useChatHandlers(
  setShowIntroMessage: (show: boolean) => void,
  setStaticRefreshTrigger: React.Dispatch<React.SetStateAction<number>>,
  resetTranscript: () => void,
) {
  const resetChatHistoryRef = useRef<(() => void) | null>(null);

  const handleClear = useCallback(() => {
    liveHub.notifySessionChanged();
    setShowIntroMessage(true);
    resetTranscript();
    setStaticRefreshTrigger((prev) => prev + 1);
  }, [setShowIntroMessage, setStaticRefreshTrigger, resetTranscript]);

  const handleReload = useCallback(async () => {
    await fireConfigChange("reload").catch(() => {});
    if (resetChatHistoryRef.current) {
      resetChatHistoryRef.current();
    }
    setShowIntroMessage(false);
    resetTranscript();
  }, [setShowIntroMessage, resetTranscript]);

  return {
    handleClear,
    handleReload,
    resetChatHistoryRef,
  };
}
