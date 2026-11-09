import { connectViaWebSocket } from "@zcode/client";
import type { IPlatformService } from "@zcode/shared";
import { AppErrorBoundary, Root, setHostCapabilities, ZCodeIntlProvider } from "@zcode/ui";
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

  // This host is TNT: it has no ZCode account, no coding-plan subscription and
  // its own model config, and the services edit files on the machine serving
  // this page. Telling the UI so removes the login/purchase surfaces that can
  // never work here instead of letting them fail one click at a time.
  setHostCapabilities({
    codingPlan: false,
    localProvidersOnly: true,
    localFileSettings: true,
  });

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
        />
      </ZCodeIntlProvider>
    </AppErrorBoundary>,
  );

  return services;
}
