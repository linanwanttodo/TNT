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
  "src/commands/ls.ts":
    "strips a session id prefix produced outside this package",
  "src/ui/TUIChat.tsx":
    "strips a session id prefix produced outside this package",
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
