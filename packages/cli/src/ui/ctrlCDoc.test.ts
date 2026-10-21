import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/ctrl-c-behavior.md` is the page a user reads after the CLI refuses to exit, and
 * every claim in it is one arithmetic constant or one call site away from being wrong:
 * the window, the auto-hide timer, the key that draws the message, and the call that
 * actually leaves. The page used to promise separate menu/selector behavior and an input
 * clear as part of the SIGINT path; the handler below does neither, so those claims were
 * removed rather than carried as folklore.
 *
 * The window and the message key are read from the sources that hold them, so changing
 * either without amending the page reddens here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "ctrl-c-behavior.md");
const ENTRY = path.join(packageRoot, "src", "index.ts");
const BAR = path.join(here, "components", "BottomStatusBar.tsx");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

describe("spec/ctrl-c-behavior.md agrees with the SIGINT handler", () => {
  const doc = read(DOC);
  const source = read(ENTRY);
  const bar = read(BAR);

  it("reads a handler that really gates on a window", () => {
    expect(doc.length).toBeGreaterThan(250);
    expect(source).toContain("export function enableSigintHandler()");
    expect(source).toContain("timeSinceLastCtrlC <= 1000");
  });

  it("states the 1 second window the handler compares against", () => {
    expect(doc).toMatch(/1 second/);
  });

  it("states the auto-hide the handler schedules", () => {
    expect(/setTimeout\(\(\) => \{[\s\S]{0,200}?\}, 1000\)/.test(source)).toBe(
      true,
    );
    expect(doc).toMatch(/clear after 1 second/);
  });

  it("names the message key the status bar renders", () => {
    expect(bar).toContain('t("status.exit")');
    expect(doc).toContain("status.exit");
  });

  it("states that the second press leaves through gracefulExit", () => {
    expect(source).toContain("gracefulExit(0)");
    expect(doc).toContain("gracefulExit");
    expect(doc).toMatch(/Unmounts the TUI/i);
  });

  it("claims no input clear or selector behavior on the SIGINT path", () => {
    expect(doc).not.toMatch(/clear(s)? (any )?text/i);
    expect(doc).not.toMatch(/selector/i);
  });
});
