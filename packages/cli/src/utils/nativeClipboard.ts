import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.js";

interface NativeClipboardHelper {
  getImage(): Promise<Uint8Array | null | undefined>;
}

const requireNative = createRequire(import.meta.url);
let loaded = false;
let helper: NativeClipboardHelper | undefined;

function nativeFile(platform: NodeJS.Platform): string | undefined {
  switch (platform) {
    case "linux":
      return "linux-platform-x11.node";
    case "darwin":
      return "darwin-platform.node";
    case "win32":
      return "win32-platform.node";
    default:
      return undefined;
  }
}

function candidates(platform: NodeJS.Platform, file: string): string[] {
  const relative = path.join(
    "native",
    platform,
    "prebuilds",
    `${platform}-${process.arch}`,
    file,
  );
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    // Bundled CLI: dist/native/...
    path.join(moduleDir, relative),
    // Source/dev: packages/cli/native/...
    path.resolve(moduleDir, "..", "..", relative),
    // Standalone binary beside the executable.
    path.join(path.dirname(process.execPath), relative),
  ];
}

function loadHelper(): NativeClipboardHelper | undefined {
  if (process.arch !== "x64" && process.arch !== "arm64") return undefined;
  // The Linux helper is X11-only. Wayland without XWayland has no DISPLAY and
  // must use wl-paste instead.
  if (process.platform === "linux" && !process.env.DISPLAY) return undefined;

  const file = nativeFile(process.platform);
  if (!file) return undefined;

  for (const candidate of candidates(process.platform, file)) {
    try {
      const loadedModule = requireNative(
        candidate,
      ) as Partial<NativeClipboardHelper>;
      if (typeof loadedModule?.getImage === "function") {
        return loadedModule as NativeClipboardHelper;
      }
    } catch {
      // Try the next packaging location.
    }
  }
  return undefined;
}

function getNativeClipboard(): NativeClipboardHelper | undefined {
  if (loaded) return helper;
  loaded = true;
  helper = loadHelper();
  if (!helper) {
    logger.debug("Native clipboard helper is unavailable");
  }
  return helper;
}

/** Undefined means unavailable or no image; a Buffer is the raw clipboard image. */
export async function getNativeClipboardImage(): Promise<Buffer | undefined> {
  const clipboard = getNativeClipboard();
  if (!clipboard) return undefined;
  try {
    const image = await clipboard.getImage();
    if (!image || image.length === 0) return undefined;
    return Buffer.from(image);
  } catch (error) {
    logger.debug("Native clipboard image read failed", error);
    return undefined;
  }
}
