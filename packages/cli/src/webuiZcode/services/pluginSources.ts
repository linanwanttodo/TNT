import * as fs from "node:fs";
import * as path from "node:path";

import type { ZCodePluginDiagnostic } from "@zcode/shared";

import { parseMarketplaceSource } from "../../plugins/marketplaceCommand.js";
import type {
  MarketplaceSource,
  PluginSource,
} from "../../plugins/marketplaceTypes.js";

import { unavailable } from "./pluginErrors.js";
import { diagnostic } from "./pluginMapping.js";

const INSTALLABLE_SOURCE_KINDS = new Set([
  "npm",
  "github",
  "url",
  "git-subdir",
]);
const INSTALLABLE_SOURCE_PREFIXES = /^(github|git|url|npm):/;

export function parseSourceOrUnavailable(
  rawSource: string,
  channelName: string,
): MarketplaceSource {
  try {
    return parseMarketplaceSource(rawSource.trim()).source;
  } catch (error) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawSource.trim())) {
      unavailable(channelName);
    }
    throw error;
  }
}

export function suggestedMarketplaceName(source: MarketplaceSource): string {
  let value: string;
  if ("repo" in source) {
    value = source.repo.split("/").pop() ?? "";
  } else if ("url" in source) {
    value = safeHostname(source.url);
  } else if ("package" in source) {
    value = source.package.replace(/^@[^/]+\//, "");
  } else {
    value = path.basename(source.path);
  }
  return (value || "marketplace").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export function isInstallableSource(source: PluginSource): boolean {
  if (typeof source === "string") {
    if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
      return INSTALLABLE_SOURCE_PREFIXES.test(source);
    }
    return true;
  }
  const kind = (source as { source?: unknown }).source;
  return typeof kind === "string" && INSTALLABLE_SOURCE_KINDS.has(kind);
}

export function assertInstallableSource(
  source: PluginSource,
  channelName: string,
): void {
  if (!isInstallableSource(source)) {
    unavailable(channelName);
  }
}

export function dryRunSource(
  source: MarketplaceSource,
  name: string,
): ZCodePluginDiagnostic[] {
  if (source.source === "file" || source.source === "directory") {
    return fs.existsSync(source.path)
      ? []
      : [
          diagnostic(
            "source_missing",
            `Marketplace source ${source.path} does not exist`,
          ),
        ];
  }
  return [
    diagnostic(
      "dry_run_unavailable",
      `Dry-run validation only checks local marketplace sources; ${name} was not fetched`,
      "warning",
    ),
  ];
}
