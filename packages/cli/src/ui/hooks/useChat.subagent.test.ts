import { describe, expect, it, vi } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";

import { processSlashCommandResult } from "./useChat.helpers.js";

vi.mock("../../session/index.js", () => ({
  loadSession: vi.fn(),
  updateSessionHistory: vi.fn(),
  startNewSession: vi.fn(),
}));

const chatHistory: ChatHistoryItem[] = [];

describe("processSlashCommandResult delegation actions", () => {
  it("opens the subagent selector without touching the transcript", () => {
    const onShowSubagentsSelector = vi.fn();
    const setChatHistory = vi.fn();

    const newInput = processSlashCommandResult({
      result: { openSubagentsSelector: true },
      chatHistory,
      setChatHistory,
      onShowConfigSelector: vi.fn(),
      onShowSubagentsSelector,
    });

    expect(onShowSubagentsSelector).toHaveBeenCalledOnce();
    expect(setChatHistory).not.toHaveBeenCalled();
    expect(newInput).toBeNull();
  });

  it("loads the parent session when a command asks for it", () => {
    const onLoadSession = vi.fn();

    const newInput = processSlashCommandResult({
      result: { loadSessionId: "parent-session" },
      chatHistory,
      setChatHistory: vi.fn(),
      onShowConfigSelector: vi.fn(),
      onLoadSession,
    });

    expect(onLoadSession).toHaveBeenCalledWith("parent-session");
    expect(newInput).toBeNull();
  });

  it("falls back to plain output when no handler is wired", () => {
    const setChatHistory = vi.fn();

    processSlashCommandResult({
      result: { loadSessionId: "parent-session", output: "no parent" },
      chatHistory,
      setChatHistory,
      onShowConfigSelector: vi.fn(),
    });

    expect(setChatHistory).toHaveBeenCalledOnce();
  });
});
