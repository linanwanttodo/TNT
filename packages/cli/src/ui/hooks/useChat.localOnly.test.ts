import { describe, expect, it, vi } from "vitest";

import { getSessionNotices, clearSessionNotices } from "../sessionNotices.js";

import { processSlashCommandResult } from "./useChat.helpers.js";

/**
 * A command answer that belongs to the screen (a pairing URL with its token,
 * a status line) must never be appended to the conversation — the session
 * file is what a shared web view reads — and it must not be projected into
 * the browser either. It becomes a terminal row anchored where it was typed.
 */
describe("screen-only slash results", () => {
  it("anchors the output in the transcript and leaves history untouched", () => {
    clearSessionNotices();
    const setChatHistory = vi.fn();
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
    });

    expect(next).toBeNull();
    expect(setChatHistory).not.toHaveBeenCalled();
    expect(getSessionNotices()).toEqual([
      {
        id: expect.any(Number),
        text: "Web UI listening on http://127.0.0.1:3000/#token=secret",
        historyLength: 1,
      },
    ]);
    clearSessionNotices();
  });

  it("still writes ordinary command output to history", () => {
    clearSessionNotices();
    const setChatHistory = vi.fn();

    processSlashCommandResult({
      result: { output: "Available subagents" },
      chatHistory: [],
      setChatHistory,
    });

    expect(setChatHistory).toHaveBeenCalledTimes(1);
    expect(getSessionNotices()).toEqual([]);
  });

  it("drops screen rows when a new session starts", () => {
    clearSessionNotices();
    processSlashCommandResult({
      result: { localOnly: true, output: "URL from the previous session" },
      chatHistory: [],
      setChatHistory: vi.fn(),
    });
    expect(getSessionNotices()).toHaveLength(1);

    processSlashCommandResult({
      result: { clear: true },
      chatHistory: [],
      setChatHistory: vi.fn(),
    });

    expect(getSessionNotices()).toEqual([]);
  });
});
