import * as fs from "fs";
import * as path from "path";

import { getPluginsDirectory } from "./directories.js";

/**
 * Plugin install counts, published by the official Claude Code marketplace.
 *
 * The list is a static JSON file in the repository's `stats` branch. It is
 * fetched at most once a day and cached locally; an unavailable network just
 * means the panel sorts by name, not that discovery stops working.
 */
const COUNTS_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "install-counts-cache.json";

interface CountsCache {
  fetchedAt: string;
  counts: Array<{ plugin: string; unique_installs: number }>;
}

function cachePath(): string {
  return path.join(getPluginsDirectory(), CACHE_FILE);
}

function readCache(): Map<string, number> | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(cachePath(), "utf-8"),
    ) as CountsCache;
    if (
      typeof parsed.fetchedAt !== "string" ||
      !Array.isArray(parsed.counts) ||
      Date.now() - new Date(parsed.fetchedAt).getTime() > CACHE_TTL_MS
    ) {
      return null;
    }
    const result = new Map<string, number>();
    for (const entry of parsed.counts) {
      if (
        typeof entry.plugin === "string" &&
        typeof entry.unique_installs === "number"
      ) {
        result.set(entry.plugin, entry.unique_installs);
      }
    }
    return result;
  } catch {
    return null;
  }
}

function writeCache(counts: CountsCache["counts"]): void {
  try {
    const file = cachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ fetchedAt: new Date().toISOString(), counts }),
      "utf-8",
    );
  } catch {
    // A missing cache only costs one fetch next session.
  }
}

export async function getInstallCounts(): Promise<Map<string, number>> {
  const cached = readCache();
  if (cached) return cached;
  try {
    const response = await fetch(COUNTS_URL, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return new Map();
    const body = (await response.json()) as {
      plugins?: Array<{ plugin?: string; unique_installs?: number }>;
    };
    const counts = (body.plugins ?? [])
      .filter(
        (entry): entry is { plugin: string; unique_installs: number } =>
          typeof entry.plugin === "string" &&
          typeof entry.unique_installs === "number",
      )
      .map(({ plugin, unique_installs }) => ({
        plugin,
        unique_installs,
      }));
    const result = new Map(
      counts.map(({ plugin, unique_installs }) => [plugin, unique_installs]),
    );
    writeCache(counts);
    return result;
  } catch {
    return new Map();
  }
}

export function formatInstallCount(count: number): string {
  if (count < 1000) return String(count);
  const format = (value: number, suffix: string) => {
    const text = value.toFixed(1);
    return `${text.endsWith(".0") ? text.slice(0, -2) : text}${suffix}`;
  };
  return count < 1_000_000
    ? format(count / 1000, "K")
    : format(count / 1_000_000, "M");
}
