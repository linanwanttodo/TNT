import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/tty-less-support.md` tells an integrator which functions detect a TTY, which
 * variables stop stdin from blocking, and which message a refused TUI prints. It quoted
 * the English error text verbatim, which is now an i18n value that Chinese users never
 * see - so the page drifted the moment a locale was added. The guards below read the
 * function names, the environment variables and the message keys from the sources that
 * carry them; the error sections name the key instead of a copy of one locale.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "tty-less-support.md");
const CLI_UTILS = path.join(packageRoot, "src", "utils", "cli.ts");
const STDIN = path.join(packageRoot, "src", "utils", "stdin.ts");
const TUI = path.join(packageRoot, "src", "ui", "index.ts");
const CHAT = path.join(packageRoot, "src", "commands", "chat.ts");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

describe("spec/tty-less-support.md agrees with the guards", () => {
  const doc = read(DOC);
  const flat = doc.replace(/\s+/g, " ");

  it("reads a page and sources that exist", () => {
    expect(doc.length).toBeGreaterThan(1_000);
    expect(read(CLI_UTILS)).toContain("export function isTTYless()");
    expect(read(TUI)).toContain('t("ui.ttyLess")');
  });

  it("names the three detection helpers the utilities export", () => {
    const source = read(CLI_UTILS);
    for (const fn of [
      "isTTYless",
      "supportsInteractive",
      "hasSuppliedPrompt",
    ]) {
      expect(source).toContain(`export function ${fn}()`);
      expect(flat).toContain(fn);
    }
  });

  it("names every environment variable the stdin guard reads", () => {
    const source = read(STDIN);
    for (const name of ["FORCE_NO_TTY", "CONTINUE_CLI_TEST"]) {
      expect(source).toContain(name);
      expect(flat).toContain(name);
    }
  });

  it("names the message keys instead of quoting one locale", () => {
    expect(read(TUI)).toContain('t("ui.ttyLess")');
    expect(read(TUI)).toContain('t("ui.rawModeRequired")');
    expect(read(CHAT)).toContain('t("cli.headlessNeedsPrompt")');
    expect(flat).toContain("ui.ttyLess");
    expect(flat).toContain("ui.rawModeRequired");
    expect(flat).toContain("cli.headlessNeedsPrompt");
    expect(flat).not.toContain("A prompt is required when using");
  });

  it("claims the custom-stream bypass only while the guard has one", () => {
    const bypass = /isTTYless\(\) && !customStdin/.test(read(TUI));
    expect(/TTY-less check/i.test(flat)).toBe(true);
    expect(bypass).toBe(true);
  });

  it("does not revive upstream tool names", () => {
    expect(flat).not.toContain("run_terminal_command");
  });
});
