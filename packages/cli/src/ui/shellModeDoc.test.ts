import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/shell-mode.md` promised a `Shell` tool call, a 120 second timeout, a 5000-line
 * cap, and separate slash-command key behavior. The implementation names the tool
 * `Bash`, times out after 180 seconds of silence, caps output at 50,000 characters and
 * 1,000 lines, and never enters the permission layer at all - the command runs directly.
 * That last point is the one a reader must not miss, so it is asserted both ways.
 *
 * The numbers and the tool name are read from the sources that hold them; changing a
 * cap or routing the call through the permission checker reddens the page.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "shell-mode.md");
const SHELL = path.join(here, "hooks", "useChat.shellMode.ts");
const TERMINAL = path.join(
  packageRoot,
  "src",
  "tools",
  "runTerminalCommand.ts",
);
const INPUT = path.join(here, "UserInput.tsx");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function constant(source: string, name: string): number {
  const match = source.match(new RegExp(`${name} = (\\d+)`));
  if (!match) throw new Error(`${name} moved; this guard must move with it`);
  return Number(match[1]);
}

describe("spec/shell-mode.md agrees with the shell-mode sources", () => {
  const doc = read(DOC).replace(/\s+/g, " ");
  const shell = read(SHELL);
  const terminal = read(TERMINAL);

  it("reads sources that really implement shell mode", () => {
    expect(doc.length).toBeGreaterThan(400);
    expect(shell).toContain('message.trimStart().startsWith("!")');
    expect(terminal.length).toBeGreaterThan(5_000);
  });

  it("names the tool the handler actually creates", () => {
    expect(shell).toContain('name: "Bash"');
    expect(doc).toContain("`Bash`");
    expect(doc).not.toMatch(/Shell tool/i);
  });

  it("states the output caps the terminal tool defaults to", () => {
    const chars = constant(terminal, "DEFAULT_BASH_MAX_CHARS");
    const lines = constant(terminal, "DEFAULT_BASH_MAX_LINES");
    expect(doc).toContain(`${chars.toLocaleString("en-US")} characters`);
    expect(doc).toContain(`${lines.toLocaleString("en-US")} lines`);
  });

  it("states the timeout the terminal tool defaults to", () => {
    const timeout = Number(
      terminal.match(/let TIMEOUT_MS = (\d+);/)?.[1] ?? NaN,
    );
    expect(Number.isFinite(timeout)).toBe(true);
    expect(doc).toContain(`${timeout / 1000} seconds`);
  });

  it("warns that the TUI bypasses permissions only while it does", () => {
    const bypasses = !/checkToolPermission/.test(shell);
    expect(/does not consult the permission policies/.test(doc)).toBe(bypasses);
  });

  it("states the Esc rule the input implements", () => {
    expect(read(INPUT)).toContain('inputText.trim() === "!"');
    expect(doc).toMatch(/trimmed input is exactly `!`/);
  });
});
