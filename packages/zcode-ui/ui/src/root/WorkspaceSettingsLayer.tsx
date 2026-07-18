import { useEffect } from "react";
import { SettingsPage } from "@/SettingsPage.js";
import { getHostCapabilities } from "@/host-capabilities.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import type { WorkspaceSettingsLayerProps } from "@/root/types.js";

export function WorkspaceSettingsLayer({
  workspaceScopedServices,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  isWebRemoteControl,
  windowsWindowControlsRightPaddingPx,
  captionWorkspacePath,
  onBack,
  onCreateTask,
  onOpenWorkspace,
  onOpenRemoteWorkspace,
  allowOpenWorkspace,
  onLogin,
  onLogout,
  user,
}: WorkspaceSettingsLayerProps) {
  // Editing files on the machine that serves this page is a local-host
  // surface; a browser shell over its own host can offer it even though it
  // is not the ZCode desktop app.
  const settingsDesktop =
    isDesktop || getHostCapabilities().localFileSettings;
  useEffect(() => {
    logger.info("[Root] settings layer mounted");
    return () => {
      logger.info("[Root] settings layer unmounted");
    };
  }, []);

  return (
    <div className="absolute inset-0 z-10">
      {workspaceScopedServices ? (
        <ServiceProvider services={workspaceScopedServices}>
          <SettingsPage
            isDesktop={settingsDesktop}
            isMacDesktop={isMacDesktop}
            isWindowsDesktop={isWindowsDesktop}
            isWebRemoteControl={isWebRemoteControl}
            windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
            captionWorkspacePath={captionWorkspacePath}
            onBack={onBack}
            onCreateTask={onCreateTask}
            onOpenWorkspace={onOpenWorkspace}
            onOpenRemoteWorkspace={onOpenRemoteWorkspace}
            allowOpenWorkspace={allowOpenWorkspace}
            onLogin={onLogin}
            onLogout={onLogout}
            user={user}
          />
        </ServiceProvider>
      ) : (
        <SettingsPage
          isDesktop={settingsDesktop}
          isMacDesktop={isMacDesktop}
          isWindowsDesktop={isWindowsDesktop}
          isWebRemoteControl={isWebRemoteControl}
          windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
          captionWorkspacePath={captionWorkspacePath}
          onBack={onBack}
          onCreateTask={onCreateTask}
          onOpenWorkspace={onOpenWorkspace}
          onOpenRemoteWorkspace={onOpenRemoteWorkspace}
          allowOpenWorkspace={allowOpenWorkspace}
          onLogin={onLogin}
          onLogout={onLogout}
          user={user}
        />
      )}
    </div>
  );
}
