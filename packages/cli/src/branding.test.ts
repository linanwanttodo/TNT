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
 * them. They keep the CONTINUE_ prefix on purpose, so this pins the exact set
 * rather than letting a rename pass change one and break those callers.
 */
const ENVIRONMENT_INTERFACE = [
  "CONTINUE_API_BASE",
  "CONTINUE_CLI_AUTO_UPDATED",
  "CONTINUE_CLI_BASH_MAX_OUTPUT_CHARS",
  "CONTINUE_CLI_BASH_MAX_OUTPUT_LINES",
  "CONTINUE_CLI_DIFF_MAX_OUTPUT_LENGTH",
  "CONTINUE_CLI_ENABLE_TELEMETRY",
  "CONTINUE_CLI_FETCH_MAX_OUTPUT_LENGTH",
  "CONTINUE_CLI_MANAGED_RULES_DIR",
  "CONTINUE_CLI_MAX_TOOL_RESULT_CHARS",
  "CONTINUE_CLI_READ_FILE_MAX_OUTPUT_CHARS",
  "CONTINUE_CLI_READ_FILE_MAX_OUTPUT_LINES",
  "CONTINUE_CLI_SEARCH_CODE_MAX_RESULT_CHARS",
  "CONTINUE_CLI_SEARCH_CODE_MAX_RESULTS",
  "CONTINUE_CLI_TEST",
  "CONTINUE_CLI_TEST_SESSION_ID",
  "CONTINUE_GLOBAL_DIR",
  "CONTINUE_LOG_LEVEL",
  "CONTINUE_METRICS_ENABLED",
  "CONTINUE_REMOTE",
  "CONTINUE_USE_BEDROCK",
  "CONTINUE_USER_ID",
];

describe("environment interface", () => {
  it("reads exactly the documented set of CONTINUE_ names", () => {
    const packageRoot = process.cwd();
    const names = new Set<string>();
    for (const file of sourceFiles(path.join(packageRoot, "src"))) {
      const content = fs.readFileSync(file, "utf-8");
      for (const match of content.matchAll(
        /process\.env(?:\.|\[")(CONTINUE_[A-Z_]+)/g,
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
});
