import { describe, expect, it } from "vitest";

import { hookShellCommand } from "./hookRunner.js";

/**
 * `cmd.exe /s /c` strips the first and last quote of the string after `/c`. A hook whose
 * arguments are quoted - any Windows path with a space forces that - therefore loses its
 * own first and last quote unless the command is wrapped once more, and the whole command
 * arrives glued together. These cases pin the shape that survives both kinds of command.
 */
describe("how a hook command reaches its shell", () => {
  it("wraps the command once for cmd.exe and asks for the arguments verbatim", () => {
    const invocation = hookShellCommand("echo hi", "win32");

    expect(invocation.shell).toBe("cmd.exe");
    expect(invocation.args).toEqual(["/d", "/s", "/c", '"echo hi"']);
    // Node escapes embedded quotes with backslashes, which cmd.exe does not read as
    // escapes, so the argument vector has to reach the process untouched.
    expect(invocation.verbatim).toBe(true);
  });

  it("leaves the caller's own quoting intact on win32", () => {
    const command = '"C:\\a b\\node.exe" "script.mjs" "a b.txt"';
    const [flag, arg] = hookShellCommand(command, "win32").args.slice(2);

    expect(flag).toBe("/c");
    // Exactly one pair is added, so stripping what cmd.exe strips yields the user's text.
    expect(arg.slice(1, -1)).toBe(command);
  });

  it("passes a POSIX command through unchanged", () => {
    const invocation = hookShellCommand('echo "hi" && true', "linux");

    expect(invocation.shell).toBe("/bin/sh");
    expect(invocation.args).toEqual(["-c", 'echo "hi" && true']);
    expect(invocation.verbatim).toBe(false);
  });
});
