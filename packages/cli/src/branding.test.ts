import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { TELEMETRY_SERVICE_NAME } from "./telemetry/telemetryService.js";

/**
 * The product is called TNT, but a few identifiers still say continue-cli.
 * This scans the sources so a new one cannot slip in unnoticed, and so the
 * remaining ones stay deliberate.
 */
const ALLOWED: Record<string, string> = {
  "src/services/GitAiIntegrationService.ts":
    "the checkpoint command is an external contract; the argument it receives is not ours to rename",
};

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
      continue;
    found.push(full);
  }
  return found;
}

describe("product naming", () => {
  it("reports itself as tnt-cli to the telemetry backend", () => {
    expect(TELEMETRY_SERVICE_NAME).toBe("tnt-cli");
  });

  it("has no unexpected continue-cli identifier left in the sources", () => {
    const packageRoot = process.cwd();
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(packageRoot, "src"))) {
      const relative = path
        .relative(packageRoot, file)
        .split(path.sep)
        .join("/");
      if (ALLOWED[relative]) continue;
      if (fs.readFileSync(file, "utf-8").includes("continue-cli")) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest: every entry still needs it", () => {
    const packageRoot = process.cwd();
    const stale = Object.keys(ALLOWED).filter(
      (relative) =>
        !fs
          .readFileSync(path.join(packageRoot, relative), "utf-8")
          .includes("continue-cli"),
    );

    expect(stale).toEqual([]);
  });
});

/**
 * The environment names are an interface: CI jobs, hook scripts and users set
 * them, so every name read from the environment is pinned here and a new one
 * has to be documented before it can be read.
 *
 * `TNT_` is the only prefix this product reads any more. The single remaining
 * `CONTINUE_` name is `CONTINUE_PROJECT_DIR`, which is read nowhere: it is
 * written into the environment of a hook script the user authored, so it goes
 * out beside `TNT_PROJECT_DIR` for one major version and then stops.
 */
const ENVIRONMENT_INTERFACE = [
  "CLAUDE_CODE_PERMISSION_MODE",
  "TNT_ACP_WORKER_ENTRY",
  "TNT_ALT_SCREEN",
  "TNT_API_BASE",
  "TNT_AUTO_UPDATED",
  "TNT_BASH_MAX_OUTPUT_CHARS",
  "TNT_BASH_MAX_OUTPUT_LINES",
  "TNT_BROWSER_ENDPOINT",
  "TNT_CACHE_GAP_MS",
  "TNT_CACHE_HIT_FLOOR",
  "TNT_DEFER_MCP_TOOLS",
  "TNT_DIFF_MAX_OUTPUT_LENGTH",
  "TNT_ENABLE_TELEMETRY",
  "TNT_FETCH_MAX_OUTPUT_LENGTH",
  "TNT_GLOBAL_DIR",
  "TNT_GLOB_MAX_RESULTS",
  "TNT_HEADLESS_TIMEOUT",
  "TNT_LOG_LEVEL",
  "TNT_MANAGED_RULES_DIR",
  "TNT_MAX_TOOL_RESULT_CHARS",
  "TNT_MCP_IDLE_TIMEOUT_MS",
  "TNT_METRICS_ENABLED",
  "TNT_PERMISSION_MODE",
  "TNT_PLUGINS_DIR",
  "TNT_READ_FILE_MAX_OUTPUT_CHARS",
  "TNT_READ_FILE_MAX_OUTPUT_LINES",
  "TNT_REMOTE",
  "TNT_SEARCH_CODE_MAX_RESULTS",
  "TNT_SEARCH_CODE_MAX_RESULT_CHARS",
  "TNT_TEST",
  "TNT_TEST_SESSION_ID",
  "TNT_THEME",
  "TNT_TRUST_PROJECT",
  "TNT_USER_ID",
  "TNT_USE_BEDROCK",
  "TNT_WEB_SEARCH_KEY",
  "TNT_WEB_SEARCH_URL",
];

describe("environment interface", () => {
  it("reads exactly the documented set of TNT_ and CONTINUE_ names", () => {
    const packageRoot = process.cwd();
    const names = new Set<string>();
    for (const file of sourceFiles(path.join(packageRoot, "src"))) {
      const content = fs.readFileSync(file, "utf-8");
      for (const match of content.matchAll(
        /(?:process\.env(?:\.|\[")|env\.)((?:TNT_|CONTINUE_|CLAUDE_CODE_)[A-Z_]+)/g,
      )) {
        names.add(match[1]);
      }
    }

    expect([...names].sort()).toEqual([...ENVIRONMENT_INTERFACE].sort());
  });

  it("carries no stale home directory or site reference", () => {
    const packageRoot = process.cwd();
    const offenders = sourceFiles(path.join(packageRoot, "src"))
      .filter((file) => {
        const content = fs.readFileSync(file, "utf-8");
        return (
          content.includes("continue.dev") || content.includes("/.continue/")
        );
      })
      .map((file) =>
        path.relative(packageRoot, file).split(path.sep).join("/"),
      );

    expect(offenders).toEqual([]);
  });

  /**
   * A flag name declared by both the root command and a subcommand is not a
   * harmless duplicate: commander hands the subcommand action the parent's
   * absence, so `tnt review --format json` reached the review code with no format
   * at all and silently produced text. `review` is the fix that proves the shape;
   * this guard keeps the class from coming back.
   */
  /**
   * `review --format` is the one name a subcommand shares with the root command.
   * The value never arrived on the subcommand's own options, which is the bug that
   * made `tnt review --format json` print text; the action reads either place
   * now, so this name is tolerated knowingly. Any new overlap fails the guard.
   */
  const ALLOWED_ROOT_NAME_OVERLAPS = ["review --format"];

  describe("commander option names", () => {
    const flagsOf = (text: string) =>
      new Set([...text.matchAll(/"--([a-z][a-z0-9-]+)/g)].map((m) => m[1]));

    it("gives no subcommand a flag name the root command already owns", () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), "src", "index.ts"),
        "utf-8",
      );
      const parts = source.split(/\.command\(\s*"([a-z][a-z0-9-]*)/);
      const root = flagsOf(parts[0]);

      const collisions: string[] = [];
      for (let i = 1; i < parts.length; i += 2) {
        const command = parts[i];
        const body = parts[i + 1] ?? "";
        for (const flag of flagsOf(body)) {
          if (root.has(flag)) {
            collisions.push(`${command} --${flag}`);
          }
        }
      }

      expect(collisions).toEqual(ALLOWED_ROOT_NAME_OVERLAPS);
    });
  });
});
