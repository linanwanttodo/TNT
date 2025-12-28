import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/shell-mode.md` describes behaviour a user can trigger with one
 * keystroke and no confirmation prompt: `!` runs a command outside the
 * permission layer. The claims are read back from the implementation, so a
 * change to activation, the indicator, the tool lifecycle or the limits has to
 * update the page in the same change.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(packageRoot, ...segments), "utf-8");
}

const doc = read("spec", "shell-mode.md");
const activation = read("src", "ui", "hooks", "useChat.shellMode.ts");
const runner = read("src", "tools", "runTerminalCommand.ts");
const input = read("src", "ui", "UserInput.tsx");
const entry = read("src", "index.ts");

describe("spec/shell-mode.md agrees with the implementation", () => {
  it("reads the page and every source it names", () => {
    expect(doc.length).toBeGreaterThan(500);
    expect(activation).toContain("handleBashModeProcessing");
    expect(runner).toContain("runTerminalCommandTool");
    expect(input).toContain("showBashMode");
  });

  it("matches the activation rule and the empty-command exception", () => {
    expect(activation).toMatch(/trimStart\(\)\.startsWith\("!"\)/);
    expect(activation).toContain("if (!bashCommand)");
    expect(doc).toMatch(/trimmed text is only `!`/);
  });

  it("matches the yellow border and the `$ ` prompt", () => {
    expect(input).toMatch(/showBashMode\s*\?\s*"yellow"/);
    expect(input).toMatch(/showBashMode\s*\?\s*"\$ "/);
    expect(doc).toContain("yellow");
    expect(doc).toContain("`$ `");
  });

  it("matches the tool-call lifecycle and the result statuses", () => {
    expect(activation).toContain('name: "Bash"');
    expect(activation).toContain('"calling"');
    expect(activation).toContain('"done"');
    expect(activation).toContain('"errored"');
    expect(activation).toContain("return null");
    expect(doc).toMatch(/does not consult the permission\s+policies/);
    expect(activation).not.toMatch(/permissions\//);
  });

  it("matches the output caps and the inactivity timeout", () => {
    expect(runner).toContain("DEFAULT_BASH_MAX_CHARS = 50000");
    expect(runner).toContain("DEFAULT_BASH_MAX_LINES = 1000");
    expect(runner).toContain("CONTINUE_CLI_BASH_MAX_OUTPUT_CHARS");
    expect(runner).toContain("CONTINUE_CLI_BASH_MAX_OUTPUT_LINES");
    expect(runner).toContain("TIMEOUT_MS = 180000");
    expect(runner).toContain("Math.min(timeout, 600)");
    expect(runner).toContain("seconds of no output");
    expect(runner).toContain("TEST_TERMINAL_TIMEOUT");

    expect(doc).toContain("50,000");
    expect(doc).toContain("1,000");
    expect(doc).toContain("CONTINUE_CLI_BASH_MAX_OUTPUT_CHARS");
    expect(doc).toContain("CONTINUE_CLI_BASH_MAX_OUTPUT_LINES");
    expect(doc).toContain("180 seconds");
    expect(doc).toContain("600 seconds");
    expect(doc).toContain("TEST_TERMINAL_TIMEOUT");
    expect(doc).toMatch(/output resets it/);
  });

  it("matches the two-stage Ctrl+C claim", () => {
    expect(entry).toContain("timeSinceLastCtrlC <= 1000");
    expect(doc).toMatch(
      /single\s+Ctrl\+C shows the exit hint and does not stop/,
    );
    expect(activation).not.toContain("SIGINT");
  });
});
