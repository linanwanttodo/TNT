import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The TTY-less page tells extension authors and CI users why a run will not
 * hang. Its claims are read back from the four guards that make that true, so
 * removing or relaxing one has to update the page in the same change.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(packageRoot, ...segments), "utf-8");
}

const doc = read("spec", "tty-less-support.md");
const cli = read("src", "utils", "cli.ts");
const stdin = read("src", "utils", "stdin.ts");
const ui = read("src", "ui", "index.ts");
const chat = read("src", "commands", "chat.ts");
const logger = read("src", "utils", "logger.ts");
const i18n = read("src", "i18n", "index.ts");

describe("spec/tty-less-support.md agrees with the implementation", () => {
  it("reads the page and every source it names", () => {
    expect(doc.length).toBeGreaterThan(500);
    expect(cli).toContain("export function isTTYless");
    expect(stdin).toContain("readStdinSync");
    expect(ui).toContain("startTUIChat");
    expect(chat).toContain("headlessNeedsPrompt");
  });

  it("defines TTY-less as all three streams missing a TTY", () => {
    expect(cli).toMatch(
      /process\.stdin\.isTTY !== true &&\s+process\.stdout\.isTTY !== true &&\s+process\.stderr\.isTTY !== true/,
    );
    expect(cli).toContain("export function supportsInteractive");
    expect(cli).toContain("export function hasSuppliedPrompt");
  });

  it("keeps every stdin early return the page lists", () => {
    expect(stdin).toMatch(/NODE_ENV === "test"/);
    expect(stdin).toMatch(/VITEST === "true"/);
    expect(stdin).toContain("JEST_WORKER_ID");
    expect(stdin).toMatch(/CONTINUE_CLI_TEST === "true"/);
    expect(stdin).toMatch(/isHeadlessMode\(\) && hasSuppliedPrompt\(\)/);
    expect(stdin).toMatch(/FORCE_NO_TTY === "true"/);
    expect(stdin).toContain("readFileSync(0");
  });

  it("keeps both TUI guards and the raw-mode refusal", () => {
    expect(ui).toContain("if (isHeadlessMode())");
    expect(ui).toContain("if (isTTYless() && !customStdin)");
    expect(ui).toContain('t("ui.ttyLess")');
    expect(ui).toContain('t("ui.rawModeRequired")');
  });

  it("keeps the headless prompt refusal with its resume/fork exception", () => {
    expect(chat).toContain('t("cli.headlessNeedsPrompt")');
    expect(chat).toMatch(/if \(options\.resume \|\| options\.fork\)/);
  });

  it("keeps the message tails the page promises", () => {
    expect(i18n).toContain('"ui.ttyLess"');
    expect(i18n).toContain('"ui.rawModeRequired"');
    expect(doc).toMatch(/Both messages end with the `-p` command/);

    const ttyLess = i18n.slice(
      i18n.indexOf('"ui.ttyLess"'),
      i18n.indexOf('"ui.rawModeRequired"'),
    );
    const rawMode = i18n.slice(
      i18n.indexOf('"ui.rawModeRequired"'),
      i18n.indexOf('"ui.remoteTtyLess"'),
    );
    expect(ttyLess).toContain("-p");
    expect(rawMode).toContain("-p");

    expect(doc).toContain('`-p "prompt"`');
    expect(doc).toContain("piping stdin");
    expect(doc).toContain("`-p --agent <file>`");
  });

  it("keeps the documented environment variables and drops the old checklist", () => {
    expect(doc).toContain("FORCE_NO_TTY");
    expect(doc).toContain("CONTINUE_CLI_TEST");
    expect(doc).toContain("NODE_ENV=test");
    expect(doc).toContain("VITEST=true");
    expect(doc).toContain("JEST_WORKER_ID");
    expect(doc).not.toContain("Implementation Checklist");
  });

  it("matches the logger scope", () => {
    expect(logger).toContain("if (headless && isTTYlessEnvironment)");
    expect(logger).toContain('setDefaultEncoding("utf8")');
    expect(doc).toMatch(/When headless mode runs without any TTY/);
  });
});
