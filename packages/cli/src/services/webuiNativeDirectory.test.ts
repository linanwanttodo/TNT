import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => ({ execFile: vi.fn() }));

// A real directory on every runner: "/tmp" is absent on Windows.
const existingDir = path.resolve(os.tmpdir());

vi.mock("node:child_process", () => ({
  execFile: execFileMock.execFile,
}));

import { requestNativeDirectory } from "./webuiNativeDirectory.js";

/** promisify's callback is (error, stdout, stderr); execFile's 4th arg. */
function answerOnce(
  outcome:
    | { kind: "path"; path: string }
    | { kind: "cancel" }
    | { kind: "missing" }
    | { kind: "failure"; stderr: string },
): void {
  execFileMock.execFile.mockImplementationOnce(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: unknown, stdout?: string, stderr?: string) => void,
    ) => {
      if (outcome.kind === "path") {
        callback(null, `${outcome.path}\n`, "");
        return;
      }
      if (outcome.kind === "cancel") {
        callback(Object.assign(new Error("cancelled"), { code: 1 }), "", "");
        return;
      }
      if (outcome.kind === "failure") {
        // Real execFile attaches stdout/stderr to the rejected error object;
        // promisify drops the callback's extra arguments on rejection.
        callback(
          Object.assign(new Error("exit 1"), {
            code: 1,
            stdout: "",
            stderr: outcome.stderr,
          }),
          "",
          outcome.stderr,
        );
        return;
      }
      callback(
        Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        "",
        "",
      );
    },
  );
}

describe("the WebUI native directory chooser", () => {
  beforeEach(() => {
    execFileMock.execFile.mockReset();
  });

  it("returns the absolute path the desktop chooser selected", async () => {
    answerOnce({ kind: "path", path: existingDir });

    await expect(requestNativeDirectory()).resolves.toBe(existingDir);
    expect(execFileMock.execFile).toHaveBeenCalledWith(
      "zenity",
      expect.any(Array),
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    );
  });

  it("answers null when the user cancels the dialog", async () => {
    answerOnce({ kind: "cancel" });

    await expect(requestNativeDirectory()).resolves.toBeNull();
  });

  it("throws a tool failure when the chooser exits non-zero with stderr", async () => {
    answerOnce({ kind: "failure", stderr: "cannot open display" });

    await expect(requestNativeDirectory()).rejects.toThrow(
      /zenity.*cannot open display/,
    );
    // A broken chooser is not a cancel: the request fails instead of
    // pretending the user dismissed the dialog.
    expect(execFileMock.execFile).toHaveBeenCalledTimes(1);
  });

  it("treats a desktop-closed dialog as a cancel, not a missing tool", async () => {
    execFileMock.execFile.mockImplementationOnce(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: unknown) => void,
      ) => {
        callback(
          Object.assign(new Error("killed"), {
            signal: "SIGTERM",
            killed: true,
          }),
        );
      },
    );

    await expect(requestNativeDirectory()).resolves.toBeNull();
    expect(execFileMock.execFile).toHaveBeenCalledTimes(1);
  });

  it("tries the next chooser when one is not installed", async () => {
    answerOnce({ kind: "missing" });
    answerOnce({ kind: "path", path: existingDir });

    await expect(requestNativeDirectory()).resolves.toBe(existingDir);
    expect(execFileMock.execFile).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when no chooser exists", async () => {
    answerOnce({ kind: "missing" });
    answerOnce({ kind: "missing" });
    answerOnce({ kind: "missing" });

    await expect(requestNativeDirectory()).rejects.toThrow(
      /No native directory chooser/,
    );
  });

  it("rejects a path that is not a directory", async () => {
    answerOnce({
      kind: "path",
      path: path.join(existingDir, "tnt-no-such-dir"),
    });

    await expect(requestNativeDirectory()).resolves.toBeNull();
  });
});
