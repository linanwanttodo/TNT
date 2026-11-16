import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: execFileMock.execFile,
}));

import { requestNativeDirectory } from "./webuiNativeDirectory.js";

/** promisify's callback is (error, stdout, stderr); execFile's 4th arg. */
function answerOnce(
  outcome:
    { kind: "path"; path: string } | { kind: "cancel" } | { kind: "missing" },
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
    answerOnce({ kind: "path", path: "/tmp" });

    await expect(requestNativeDirectory()).resolves.toBe("/tmp");
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
    answerOnce({ kind: "path", path: "/tmp" });

    await expect(requestNativeDirectory()).resolves.toBe("/tmp");
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
    answerOnce({ kind: "path", path: "/definitely-not-a-real-directory-tnt" });

    await expect(requestNativeDirectory()).resolves.toBeNull();
  });
});
