import { connectViaWebSocket } from "@zcode/client";
import type { IPlatformService } from "@zcode/shared";
import { AppErrorBoundary, Root, ZCodeIntlProvider } from "@zcode/ui";
import { createRoot } from "react-dom/client";

export type TntWebUiServiceAccessor = Awaited<ReturnType<typeof connectViaWebSocket>>;

export interface TntWebUiBootstrapOptions {
  wsUrl: string;
  platform: IPlatformService;
  initialWorkspaceAbsPath?: string;
  allowOpenWorkspace?: boolean;
}

export async function bootstrapTntWebUi({
  wsUrl,
  platform,
  initialWorkspaceAbsPath,
  allowOpenWorkspace = true,
}: TntWebUiBootstrapOptions): Promise<TntWebUiServiceAccessor> {
  const services = await connectViaWebSocket(wsUrl, { onClose: () => {} });

  createRoot(document.getElementById("root")!).render(
    <AppErrorBoundary>
      <ZCodeIntlProvider
        settingService={services.settingService}
        broadcastService={services.broadcastService}
      >
        <Root
          services={services}
          platform={platform}
          initialWorkspaceAbsPath={initialWorkspaceAbsPath}
          allowOpenWorkspace={allowOpenWorkspace}
          preferDirectoryBrowser
          supportsEmbeddedBrowser={false}
          allowRemoteWorkspace={false}
          restoreSession={false}
        />
      </ZCodeIntlProvider>
    </AppErrorBoundary>,
  );

  return services;
}
