import { describe, expect, it, vi } from "vitest";

import { getSessionNotices, clearSessionNotices } from "../sessionNotices.js";

import { processSlashCommandResult } from "./useChat.helpers.js";

/**
 * A command answer that belongs to the screen (a pairing URL with its token,
 * a status line) must never be appended to the conversation: the session file
 * is what a shared web view reads. It lands on the session's notice rows
 * instead, which outlive the status line but never reach a prompt.
 */
describe("screen-only slash results", () => {
  it("puts the output on the notice rows and leaves history untouched", () => {
    const setChatHistory = vi.fn();
    const onShowStatusMessage = vi.fn();
    const history = [
      {
        message: { role: "user" as const, content: "keep me" },
        contextItems: [],
      },
    ];
    clearSessionNotices();

    const next = processSlashCommandResult({
      result: {
        localOnly: true,
        output: "Web UI listening on http://127.0.0.1:3000/#token=secret",
      },
      chatHistory: history,
      setChatHistory,
      onShowStatusMessage,
    });

    expect(next).toBeNull();
    expect(setChatHistory).not.toHaveBeenCalled();
    // The answer stays visible for the rest of the session instead of
    // flashing on a status row for a few seconds.
    expect(getSessionNotices()).toEqual([
      "Web UI listening on http://127.0.0.1:3000/#token=secret",
    ]);
    expect(onShowStatusMessage).not.toHaveBeenCalled();
    clearSessionNotices();
  });

  it("still writes ordinary command output to history", () => {
    const setChatHistory = vi.fn();
    const onShowStatusMessage = vi.fn();

    processSlashCommandResult({
      result: { output: "Available subagents" },
      chatHistory: [],
      setChatHistory,
      onShowStatusMessage,
    });

    expect(setChatHistory).toHaveBeenCalledTimes(1);
    expect(onShowStatusMessage).not.toHaveBeenCalled();
  });
});
