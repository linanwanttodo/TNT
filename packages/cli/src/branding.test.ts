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
 * them. Both prefixes are pinned, so a new variable under either name has to be
 * documented before it can be read.
 * rather than letting a rename pass change one and break those callers.
 */
const ENVIRONMENT_INTERFACE = [
  "CONTINUE_API_BASE",
  "CONTINUE_CLI_AUTO_UPDATED",
  "CONTINUE_CLI_BASH_MAX_OUTPUT_CHARS",
  "CONTINUE_CLI_BASH_MAX_OUTPUT_LINES",
  "CONTINUE_CLI_CACHE_GAP_MS",
  "CONTINUE_CLI_DIFF_MAX_OUTPUT_LENGTH",
  "CONTINUE_CLI_ENABLE_TELEMETRY",
  "CONTINUE_CLI_FETCH_MAX_OUTPUT_LENGTH",
  "CONTINUE_CLI_GLOB_MAX_RESULTS",
  "CONTINUE_CLI_MANAGED_RULES_DIR",
  "CONTINUE_CLI_MAX_TOOL_RESULT_CHARS",
  "CONTINUE_CLI_READ_FILE_MAX_OUTPUT_CHARS",
  "CONTINUE_CLI_READ_FILE_MAX_OUTPUT_LINES",
  "CONTINUE_CLI_SEARCH_CODE_MAX_RESULTS",
  "CONTINUE_CLI_SEARCH_CODE_MAX_RESULT_CHARS",
  "CONTINUE_CLI_TEST",
  "CONTINUE_CLI_TEST_SESSION_ID",
  "CONTINUE_GLOBAL_DIR",
  "CONTINUE_LOG_LEVEL",
  "CONTINUE_METRICS_ENABLED",
  "CONTINUE_REMOTE",
  "CONTINUE_USER_ID",
  "CONTINUE_USE_BEDROCK",
  "TNT_API_BASE",
  "TNT_GLOBAL_DIR",
  "TNT_HEADLESS_TIMEOUT",
  "TNT_LOG_LEVEL",
  "TNT_PLUGINS_DIR",
];

describe("environment interface", () => {
  it("reads exactly the documented set of TNT_ and CONTINUE_ names", () => {
    const packageRoot = process.cwd();
    const names = new Set<string>();
    for (const file of sourceFiles(path.join(packageRoot, "src"))) {
      const content = fs.readFileSync(file, "utf-8");
      for (const match of content.matchAll(
        /process\.env(?:\.|\[")((?:TNT_|CONTINUE_)[A-Z_]+)/g,
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
