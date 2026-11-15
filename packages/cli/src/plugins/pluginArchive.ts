import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

import JSZip from "jszip";

import { t } from "../i18n/index.js";
import { fetchPublicUrl } from "../utils/urlGuard.js";

import { loadPluginFromDirectory } from "./manifest.js";
import type { MarketplaceDeps } from "./marketplaceSources.js";

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export interface ZipPluginSource {
  source: "url";
  type: "zip";
  url: string;
  sha256: string;
  path?: string;
}

function fail(reason: string): never {
  throw new Error(t("plugins.zipInvalid", { reason }));
}

function safeRelative(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\u0000-\u001f]/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === ".." || part === ".")
  ) {
    fail(t("plugins.zipUnsafePath", { path: value }));
  }
  return value.replace(/\/+$/, "");
}

async function download(
  source: ZipPluginSource,
  deps: MarketplaceDeps,
): Promise<Buffer> {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    fail(t("plugins.zipNeedsHttps"));
  }
  if (!/^[a-f0-9]{64}$/i.test(source.sha256 ?? "")) {
    fail(t("plugins.zipNeedsChecksum"));
  }
  const init = { signal: AbortSignal.timeout(30_000) };
  const response = deps.fetchArchive
    ? await deps.fetchArchive(url.href, init)
    : await fetchPublicUrl(url, init);
  if (!response.ok) fail(`HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES) {
    fail(t("plugins.zipTooLarge"));
  }
  if (!response.body) fail(t("plugins.zipEmpty"));
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) fail(t("plugins.zipTooLarge"));
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = Buffer.concat(chunks);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== source.sha256.toLowerCase())
    fail(t("plugins.zipChecksumMismatch"));
  return bytes;
}

function readEntry(
  entry: JSZip.JSZipObject,
  remaining: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream("nodebuffer") as Readable;
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > remaining) {
        stream.destroy(new Error(t("plugins.zipTooLarge")));
        reject(new Error(t("plugins.zipTooLarge")));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function installZipPlugin(
  source: ZipPluginSource,
  target: string,
  pluginName: string,
  deps: MarketplaceDeps,
): Promise<void> {
  const subpath = source.path === undefined ? "" : safeRelative(source.path);
  const bytes = await download(source, deps);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) fail(t("plugins.zipTooLarge"));
  for (const entry of entries) {
    // JSZip sanitizes traversal names; validate the original before using its result.
    safeRelative(entry.unsafeOriginalName ?? entry.name);
    const mode =
      typeof entry.unixPermissions === "number"
        ? entry.unixPermissions & 0o170000
        : 0;
    if (mode && mode !== 0o100000 && mode !== 0o040000) {
      fail(t("plugins.zipUnsafePath", { path: entry.name }));
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), ".zip-"));
  let extracted = 0;
  try {
    for (const entry of entries) {
      if (entry.dir) continue;
      if (subpath && !entry.name.startsWith(`${subpath}/`)) continue;
      const relative = subpath
        ? entry.name.slice(subpath.length + 1)
        : entry.name;
      const output = path.join(staging, safeRelative(relative));
      const content = await readEntry(entry, MAX_EXTRACTED_BYTES - extracted);
      extracted += content.length;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, content);
    }
    const plugin = loadPluginFromDirectory(staging);
    if (plugin?.name !== pluginName)
      fail(t("plugins.zipManifestMismatch", { name: pluginName }));
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
