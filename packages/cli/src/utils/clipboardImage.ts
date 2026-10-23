import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runClipboardCommand } from "./clipboardCommand.js";
import { logger } from "./logger.js";
import { getNativeClipboardImage } from "./nativeClipboard.js";

interface ClipboardImage {
  bytes: Buffer;
  mimeType: string;
}

interface ClipboardReadOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
}

function isWSL(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function isSupportedImageMimeType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.some(
    (candidate) => candidate === baseMimeType(mimeType),
  );
}

function selectPreferredImageMimeType(
  mimeTypes: readonly string[],
): string | null {
  const normalized = mimeTypes
    .map((type) => type.trim())
    .filter(Boolean)
    .map((type) => ({ raw: type, base: baseMimeType(type) }));

  for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
    const match = normalized.find((type) => type.base === preferred);
    if (match) return match.raw;
  }
  return null;
}

function detectImageMimeType(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes.subarray(0, 6).toString("ascii") === "GIF87a"
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 6 &&
    bytes.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function splitTypes(output: Buffer | undefined): string[] | undefined {
  if (output === undefined) return undefined;
  return output
    .toString("utf-8")
    .split(/\r?\n/)
    .map((type) => type.trim())
    .filter(Boolean);
}

async function readViaWlPaste(): Promise<ClipboardImage | null | undefined> {
  const types = splitTypes(
    await runClipboardCommand("wl-paste", ["--list-types"], {
      timeoutMs: 1000,
    }),
  );
  if (types === undefined) return undefined;

  const type = selectPreferredImageMimeType(types);
  if (!type) return null;

  const bytes = await runClipboardCommand(
    "wl-paste",
    ["--type", type, "--no-newline"],
    { timeoutMs: 5000 },
  );
  if (bytes === undefined) return undefined;
  if (bytes.length === 0) return null;
  return { bytes, mimeType: baseMimeType(type) };
}

async function readViaXclip(): Promise<ClipboardImage | null | undefined> {
  const types = splitTypes(
    await runClipboardCommand(
      "xclip",
      ["-selection", "clipboard", "-t", "TARGETS", "-o"],
      { timeoutMs: 1000 },
    ),
  );
  if (types === undefined) return undefined;

  const type = selectPreferredImageMimeType(types);
  if (!type) return null;

  const bytes = await runClipboardCommand(
    "xclip",
    ["-selection", "clipboard", "-t", type, "-o"],
    { timeoutMs: 5000 },
  );
  if (bytes === undefined) return undefined;
  if (bytes.length === 0) return null;
  return { bytes, mimeType: baseMimeType(type) };
}

async function readViaPowerShell(): Promise<ClipboardImage | null | undefined> {
  const tmpFile = path.join(tmpdir(), `tnt-wsl-clip-${randomUUID()}.png`);
  try {
    const winPath = await runClipboardCommand("wslpath", ["-w", tmpFile], {
      timeoutMs: 1000,
    });
    if (winPath === undefined) return undefined;

    const psPath = winPath.toString("utf-8").trim();
    if (!psPath) return null;

    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      `$path = '${psPath.replaceAll("'", "''")}'`,
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($img) { $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } else { Write-Output 'empty' }",
    ].join("; ");

    const result = await runClipboardCommand(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { timeoutMs: 5000 },
    );
    if (result === undefined) return undefined;
    if (result.toString("utf-8").trim() !== "ok") return null;

    const bytes = await readFile(tmpFile);
    if (bytes.length === 0) return null;
    return { bytes, mimeType: "image/png" };
  } catch {
    return null;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function readViaMacOS(): Promise<ClipboardImage | null | undefined> {
  const tmpFile = path.join(tmpdir(), `tnt-macos-clip-${randomUUID()}.png`);
  const escapedPath = tmpFile.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  try {
    const result = await runClipboardCommand(
      "osascript",
      [
        "-e",
        "set the clipboard to (the clipboard as «class PNGf»)",
        "-e",
        "set png_data to (the clipboard as «class PNGf»)",
        "-e",
        `set file_ref to open for access "${escapedPath}" with write permission`,
        "-e",
        "write png_data to file_ref",
        "-e",
        "close access file_ref",
      ],
      { timeoutMs: 5000 },
    );
    if (result === undefined) return undefined;
    const bytes = await readFile(tmpFile);
    return bytes.length > 0 ? { bytes, mimeType: "image/png" } : null;
  } catch {
    return null;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function readViaWindows(): Promise<ClipboardImage | null | undefined> {
  const tmpFile = path.join(tmpdir(), `tnt-win-clip-${randomUUID()}.png`);
  try {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      `$path = '${tmpFile.replaceAll("'", "''")}'`,
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($img) { $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } else { Write-Output 'empty' }",
    ].join("; ");
    const result = await runClipboardCommand(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { timeoutMs: 5000 },
    );
    if (result === undefined) return undefined;
    if (result.toString("utf-8").trim() !== "ok") return null;
    const bytes = await readFile(tmpFile);
    return bytes.length > 0 ? { bytes, mimeType: "image/png" } : null;
  } catch {
    return null;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function readViaNative(): Promise<ClipboardImage | undefined> {
  const bytes = await getNativeClipboardImage();
  if (!bytes) return undefined;
  return {
    bytes,
    mimeType: detectImageMimeType(bytes),
  };
}

/**
 * Read the clipboard image. Linux prefers Wayland's wl-paste, then xclip, then
 * the bundled X11 helper; the bundled helper is what makes this work on an
 * XWayland desktop with no clipboard utilities installed.
 */
export async function readClipboardImage(
  options: ClipboardReadOptions = {},
): Promise<ClipboardImage | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  try {
    let image: ClipboardImage | null | undefined;

    if (platform === "linux") {
      const wsl = isWSL(env);
      if (isWaylandSession(env) || wsl) {
        image = await readViaWlPaste();
      }
      if (image === undefined) image = await readViaXclip();
      if (!image && wsl) {
        image = (await readViaPowerShell()) ?? image;
      }
      if (image === undefined) image = await readViaNative();
    } else if (platform === "darwin") {
      image = await readViaMacOS();
      if (image === undefined) image = await readViaNative();
    } else if (platform === "win32") {
      image = await readViaWindows();
      if (image === undefined) image = await readViaNative();
    }

    if (!image) return null;
    if (!isSupportedImageMimeType(image.mimeType)) {
      logger.debug("Clipboard image has an unsupported MIME type", {
        mimeType: image.mimeType,
      });
      return null;
    }
    return image;
  } catch (error) {
    logger.debug("Could not read the clipboard image", error);
    return null;
  }
}

async function clipboardTypes(
  env: NodeJS.ProcessEnv,
): Promise<string[] | undefined> {
  if (isWaylandSession(env) || isWSL(env)) {
    const types = splitTypes(
      await runClipboardCommand("wl-paste", ["--list-types"], {
        timeoutMs: 1000,
      }),
    );
    if (types !== undefined) return types;
  }

  return splitTypes(
    await runClipboardCommand(
      "xclip",
      ["-selection", "clipboard", "-t", "TARGETS", "-o"],
      { timeoutMs: 1000 },
    ),
  );
}

let nativeStatus: { at: number; hasImage: boolean } | undefined;

async function nativeHasImage(): Promise<boolean> {
  const now = Date.now();
  if (nativeStatus && now - nativeStatus.at < 5000) {
    return nativeStatus.hasImage;
  }
  const image = await getNativeClipboardImage();
  const hasImage = Boolean(image);
  nativeStatus = { at: now, hasImage };
  return hasImage;
}

/** A cheap status probe for the composer; the full image read is on paste. */
export async function clipboardHasImage(
  options: ClipboardReadOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  try {
    if (platform === "linux") {
      const types = await clipboardTypes(env);
      if (types !== undefined) {
        return types.some((type) => isSupportedImageMimeType(type));
      }
      return await nativeHasImage();
    }

    if (platform === "darwin") {
      const info = await runClipboardCommand(
        "osascript",
        ["-e", "clipboard info"],
        { timeoutMs: 1000 },
      );
      if (info !== undefined) {
        const text = info.toString("utf-8");
        return (
          text.includes("«class PNGf»") ||
          text.includes("«class TIFF»") ||
          text.includes("picture")
        );
      }
      return await nativeHasImage();
    }

    if (platform === "win32") {
      const count = await runClipboardCommand(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-Clipboard -Format Image | Measure-Object | Select-Object -ExpandProperty Count",
        ],
        { timeoutMs: 1000 },
      );
      if (count !== undefined) {
        return Number.parseInt(count.toString("utf-8").trim(), 10) > 0;
      }
      return await nativeHasImage();
    }

    return false;
  } catch (error) {
    logger.debug("Could not check the clipboard for an image", error);
    return false;
  }
}
