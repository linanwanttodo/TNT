import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { logger } from "../utils/logger.js";

export function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, "../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return packageJson.version;
  } catch {
    console.warn("Warning: Could not read version from package.json");
    return "unknown";
  }
}

// Singleton to cache the latest version result
let latestVersionCache: Promise<string | null> | null = null;

export async function getLatestVersion(
  signal?: AbortSignal,
): Promise<string | null> {
  // Return cached promise if it exists
  if (latestVersionCache) {
    return latestVersionCache;
  }

  // Create and cache the promise
  latestVersionCache = (async () => {
    try {
      // Prefer the version published to the npm registry; fall back to the
      // local package version when offline. No external service is contacted.
      const { execFileSync } = await import("node:child_process");
      const latest = execFileSync("npm", ["view", "@tnt/cli", "version"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return latest || getVersion();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Request was aborted, don't log
        return null;
      }
      // Offline or npm unavailable: rely on the installed version.
      return null;
    }
  })();

  return latestVersionCache;
}

getLatestVersion()
  .then((version) => {
    if (version) {
      logger?.info(`Latest version: ${version}`);
    }
  })
  .catch((error) => {
    logger?.debug("Warning: Could not check latest version from npm");
  });

export function compareVersions(
  current: string,
  latest: string,
): "newer" | "same" | "older" {
  if (current === "unknown" || latest === "unknown") {
    return "same";
  }

  // Simple semantic version comparison
  const parseVersion = (version: string) => {
    const parts = version
      .replace(/^v/, "")
      .split(".")
      .map((part) => parseInt(part, 10));
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };

  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);

  if (currentParts.major > latestParts.major) return "newer";
  if (currentParts.major < latestParts.major) return "older";
  if (currentParts.minor > latestParts.minor) return "newer";
  if (currentParts.minor < latestParts.minor) return "older";
  if (currentParts.patch > latestParts.patch) return "newer";
  if (currentParts.patch < latestParts.patch) return "older";

  return "same";
}
