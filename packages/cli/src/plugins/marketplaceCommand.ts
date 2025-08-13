import path from "path";

import {
  forgetMarketplace,
  loadKnownMarketplaces,
} from "./marketplaceRegistry.js";
import { MarketplaceSource } from "./marketplaceTypes.js";
import { addMarketplace, createDefaultDeps } from "./marketplaceManager.js";

const SOURCE_KINDS = [
  "directory",
  "file",
  "url",
  "github",
  "git",
  "npm",
] as const;

export function parseMarketplaceSource(value: string): {
  name?: string;
  source: MarketplaceSource;
} {
  const colon = value.indexOf(":");
  const kind = colon === -1 ? "" : value.slice(0, colon);

  if (kind === "github" || kind === "git" || kind === "url" || kind === "npm") {
    const rest = value.slice(colon + 1);
    switch (kind) {
      case "url":
      case "git":
        return { source: { source: kind, url: rest } };
      case "npm":
        return { source: { source: "npm", package: rest } };
      case "github":
        return { source: { source: "github", repo: rest } };
    }
  }
  if (kind === "directory" || kind === "file") {
    return {
      source: { source: kind, path: path.resolve(value.slice(colon + 1)) },
    };
  }
  // A bare filesystem path is a directory marketplace. Checked before the
  // owner/repo shorthand, which would otherwise read "./local" as a repo.
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return { source: { source: "directory", path: path.resolve(value) } };
  }
  // `owner/repo` is the shape users type most often for a hosted catalogue.
  if (/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(value)) {
    return { source: { source: "github", repo: value } };
  }
  throw new Error(
    `Unrecognized marketplace source: ${value}. Use one of ${SOURCE_KINDS.map((k) => `${k}:<value>`).join(", ")}, or owner/repo.`,
  );
}

export interface MarketplaceCommandResult {
  output: string;
}

/**
 * Handles `/plugin marketplace ...`. The marketplace name is the registry key
 * the user chooses, so `add team /srv/market` and `add team owner/repo` address
 * the same slot.
 */
export async function runMarketplaceCommand(
  args: string[],
): Promise<MarketplaceCommandResult> {
  const [action, ...rest] = args;

  if (action === "list" || action === undefined) {
    const all = loadKnownMarketplaces();
    const names = Object.keys(all).sort();
    if (names.length === 0) {
      return { output: "No marketplaces registered." };
    }
    return {
      output: names
        .map((name) => {
          const entry = all[name];
          const detail = describeSource(entry.source);
          return `${name} - ${detail} (updated ${entry.lastUpdated})`;
        })
        .join("\n"),
    };
  }

  if (action === "add") {
    const [nameOrSource, maybeSource] = rest;
    if (!nameOrSource) {
      return {
        output:
          "Usage: /plugin marketplace add <name> <source> | /plugin marketplace add <source>",
      };
    }
    const rawSource = maybeSource ?? nameOrSource;
    const name = maybeSource ? nameOrSource : suggestedName(rawSource);
    try {
      const { source } = parseMarketplaceSource(rawSource);
      const result = await addMarketplace(name, source, createDefaultDeps());
      return {
        output: `Added marketplace ${name} with ${result.manifest.plugins.length} plugins${result.reused ? " (reused local files)" : ""}.`,
      };
    } catch (error) {
      return {
        output: `Could not add marketplace: ${(error as Error).message}`,
      };
    }
  }

  if (action === "remove") {
    const name = rest[0];
    if (!name) {
      return { output: "Usage: /plugin marketplace remove <name>" };
    }
    const removed = forgetMarketplace(name);
    return {
      output: removed
        ? `Removed marketplace ${name}. Cached plugins stay until cleaned.`
        : `No marketplace named ${name}.`,
    };
  }

  return {
    output: `Unknown marketplace action: ${action}. Use add, list or remove.`,
  };
}

function describeSource(source: MarketplaceSource): string {
  switch (source.source) {
    case "directory":
      return `directory ${source.path}`;
    case "file":
      return `file ${source.path}`;
    case "url":
      return `url ${source.url}`;
    case "github":
      return `github ${source.repo}`;
    case "git":
      return `git ${source.url}`;
    case "npm":
      return `npm ${source.package}`;
  }
}

function suggestedName(rawSource: string): string {
  const parsed = parseMarketplaceSource(rawSource);
  const value =
    "repo" in parsed.source
      ? parsed.source.repo.split("/").pop()
      : "url" in parsed.source
        ? new URL(parsed.source.url).hostname
        : "package" in parsed.source
          ? parsed.source.package.replace(/^@[^/]+\//, "")
          : path.basename(parsed.source.path);
  return (value || "marketplace").replace(/[^a-zA-Z0-9._-]/g, "-");
}
