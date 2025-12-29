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
      // Prefer the version published to the npm registry; fall back to the
      // local package version when offline. No external service is contacted.
      // The probe must stay asynchronous: it runs during service init, and a
      // synchronous npm call there froze the whole process - and first paint -
      // for as long as npm took.
      const { execFile } = await import("node:child_process");
      return await new Promise<string | null>((resolve) => {
        execFile(
          "npm",
          ["view", "@tnt/cli", "version"],
          { timeout: 5000 },
          (error: Error | null, stdout: string) => {
            // An npm failure means no registry answer at all; an empty one
            // still falls back to the installed version.
            resolve(error ? null : stdout.trim() || getVersion());
          },
        );
      });
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
