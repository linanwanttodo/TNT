import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { composeServedPrompt } from "../utils/promptNotes.js";

import { estimateContentSections } from "./contentSections.js";

function user(text: string): ChatHistoryItem {
  return { message: { role: "user", content: text }, contextItems: [] };
}

describe("estimateContentSections", () => {
  it("splits system, messages and harness notes into their own buckets", () => {
    const served = composeServedPrompt("find the bug", [
      "Local time: 2026-11-17",
    ]);
    const sections = estimateContentSections({
      systemMessage: "You are an agent in TNT.",
      systemMessageUpdates: ["Rule one"],
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: { type: "object", properties: {} },
          },
        },
      ] as any,
      chatHistory: [user(served)],
    });
    expect(sections.system).toBeGreaterThan(0);
    expect(sections.tools).toBeGreaterThan(0);
    expect(sections.messages).toBeGreaterThan(0);
    expect(sections.hookNotes).toBeGreaterThan(0);
    // The note's bytes are credited to hookNotes, not to the user's words.
    expect(sections.messages).toBeLessThan(
      estimateContentSections({
        systemMessage: "",
        chatHistory: [user("Local time: 2026-11-17\nfind the bug")],
      }).messages + 100,
    );
  });

  it("counts a plain user message as messages with no notes", () => {
    const sections = estimateContentSections({
      systemMessage: "",
      chatHistory: [user("hello")],
    });
    expect(sections.hookNotes).toBe(0);
    expect(sections.messages).toBeGreaterThan(0);
  });

  it("counts the environment context that rides in the first user message", () => {
    const withEnv = estimateContentSections({
      systemMessage: "",
      chatHistory: [],
      environmentContext: '<context name="env">cwd</context>',
    });
    expect(withEnv.hookNotes).toBeGreaterThan(0);
  });
});
