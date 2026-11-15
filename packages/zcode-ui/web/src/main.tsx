import { createWebPlatform } from "#src/platform/index.js";
import type { ServerRemoteInfo } from "@zcode/shared";
import {
  generateMobileDeviceFingerprint,
  installDocumentHiddenMotionPause,
  setStreamClientId,
} from "@zcode/ui";
import "./styles.css";

import { bootstrapTntWebUi } from "./webuiBootstrap.js";

function resolveTntWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

async function resolveInitialWorkspaceAbsPath(): Promise<string | undefined> {
  try {
    const response = await fetch("/api/server-info", { cache: "no-store" });
    if (!response.ok) {
      return undefined;
    }
    const serverInfo = (await response.json()) as Partial<ServerRemoteInfo>;
    const workspace = Array.isArray(serverInfo.workspaces) ? serverInfo.workspaces[0] : undefined;
    return workspace?.path;
  } catch {
    return undefined;
  }
}

function applyInitialTheme(): void {
  const saved = localStorage.getItem("zcode-theme") ?? "zai-dark";
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark" || saved === "zai-dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : saved === "dark"
        ? "zai-dark"
        : saved === "light"
          ? "zai-light"
          : saved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
}

function renderBootstrapError(error: unknown): void {
  console.error("[tnt-webui] failed to connect to the TNT server", error);
  const container = document.getElementById("root");
  if (container) {
    container.textContent = "Unable to connect to the TNT server. Reload to retry.";
  }
}

async function bootstrapWebApp(): Promise<void> {
  const initialWorkspaceAbsPath = await resolveInitialWorkspaceAbsPath();
  try {
    await bootstrapTntWebUi({
      wsUrl: resolveTntWsUrl(),
      platform: createWebPlatform(),
      initialWorkspaceAbsPath,
    });
  } catch (error) {
    renderBootstrapError(error);
  }
}

applyInitialTheme();
installDocumentHiddenMotionPause();
setStreamClientId(generateMobileDeviceFingerprint());
void bootstrapWebApp();
