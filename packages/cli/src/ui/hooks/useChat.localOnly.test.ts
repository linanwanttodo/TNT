import { describe, expect, it, vi } from "vitest";

import { processSlashCommandResult } from "./useChat.helpers.js";

/**
 * A command answer that belongs to the screen (a pairing URL with its token,
 * a status line) must never be appended to the conversation — the session
 * file is what a shared web view reads — and it must not be projected into
 * the browser either. It surfaces on the status line, where the user is
 * already looking.
 */
describe("screen-only slash results", () => {
  it("puts the output on the status line and leaves history untouched", () => {
    const setChatHistory = vi.fn();
    const onShowStatusMessage = vi.fn();
    const history = [
      {
        message: { role: "user" as const, content: "keep me" },
        contextItems: [],
      },
    ];

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
    expect(onShowStatusMessage).toHaveBeenCalledWith(
      "Web UI listening on http://127.0.0.1:3000/#token=secret",
    );
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
