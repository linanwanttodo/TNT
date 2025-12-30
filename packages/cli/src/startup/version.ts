import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export function getVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // From `dist/` the package root is one level up; from `src/startup/` it is two, so a
    // fixed `../package.json` answered "unknown" for every caller running the sources.
    for (const up of ["..", "../..", "../../.."]) {
      const candidate = join(here, up, "package.json");
      if (!existsSync(candidate)) continue;
      const { version } = JSON.parse(readFileSync(candidate, "utf8"));
      if (typeof version === "string" && version) return version;
    }
  } catch {
    // A missing or malformed package.json falls through to the warning below.
  }
  console.warn("Warning: Could not read version from package.json");
  return "unknown";
}

// Singleton to cache the latest version result
let latestVersionCache: Promise<string | null> | null = null;

// A parameter that no caller passes and the body ignores is a promise the
// function does not keep, so the check is simply not cancellable.
export async function getLatestVersion(): Promise<string | null> {
  // Return cached promise if it exists
  if (latestVersionCache) {
    return latestVersionCache;
  }

  // Create and cache the promise
  latestVersionCache = (async () => {
    try {
      // The CLI is distributed through GitHub Releases, so the probe asks the
      // releases API rather than a registry. The probe must stay asynchronous:
      // it runs during service init, and a synchronous call there froze the
      // whole process - and first paint - for as long as the request took.
      const response = await fetch(
        "https://api.github.com/repos/linanwanttodo/TNT/releases/latest",
        {
          headers: {
            "User-Agent": "tnt-cli",
            Accept: "application/vnd.github+json",
          },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { tag_name?: string };
      const tag = body.tag_name?.replace(/^v/, "");
      return tag || getVersion();
    } catch {
      // Offline, rate-limited or timed out: rely on the installed version.
      return null;
    }
  })();

  return latestVersionCache;
}

// No module-scope update probe. `getLatestVersion()` shells out to `npm view` with a
// five-second budget, and calling it here made importing `getVersion` - the LSP client now
// does - pay for a network check nobody asked for. `UpdateService` calls it when it checks.

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
