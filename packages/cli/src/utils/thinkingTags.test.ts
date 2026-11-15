import { describe, expect, it } from "vitest";

import {
  closedThinkBlockPattern,
  extractThinkingContent,
  stripThinkTags,
} from "./thinkingTags.js";

describe("extractThinkingContent", () => {
  it("handles a closed block and leaves the rest", () => {
    expect(extractThinkingContent("<think>a</think> b")).toEqual({
      thinking: "a",
      cleanedText: "b",
    });
  });

  it("handles a block that is still streaming", () => {
    expect(extractThinkingContent("before<think>a")).toEqual({
      thinking: "a",
      cleanedText: "before",
    });
  });

  it("ignores the tag's case", () => {
    expect(extractThinkingContent("<THINK>a</Think> b")).toEqual({
      thinking: "a",
      cleanedText: "b",
    });
  });

  it("reports the first block but removes every block from the body", () => {
    expect(
      extractThinkingContent("<think>first</think>answer<think>second</think>"),
    ).toEqual({ thinking: "first", cleanedText: "answer" });
  });

  it("keeps text that precedes a block", () => {
    expect(extractThinkingContent("lead<think>a</think>tail")).toEqual({
      thinking: "a",
      cleanedText: "leadtail",
    });
  });

  it("trims the thought and the body", () => {
    expect(extractThinkingContent("  <think>\n  a  \n</think>  b  ")).toEqual({
      thinking: "a",
      cleanedText: "b",
    });
  });

  it("returns an empty thought for an empty block", () => {
    expect(extractThinkingContent("<think></think>b")).toEqual({
      thinking: "",
      cleanedText: "b",
    });
  });

  it("leaves text without a tag untouched", () => {
    expect(extractThinkingContent("plain answer")).toEqual({
      cleanedText: "plain answer",
    });
  });

  it("handles empty input", () => {
    expect(extractThinkingContent("")).toEqual({ cleanedText: "" });
  });
});

describe("stripThinkTags", () => {
  it("removes a closed block and trims the answer", () => {
    expect(stripThinkTags("<think>a</think>\n\nanswer")).toBe("answer");
  });

  it("collapses the blank run a removed block leaves behind", () => {
    expect(stripThinkTags("a\n\n\n<think>b</think>\n\n\nc")).toBe("a\n\nc");
  });

  it("keeps an unclosed block, which is not a finished thought", () => {
    expect(stripThinkTags("a<think>b")).toBe("a<think>b");
  });
});

describe("closedThinkBlockPattern", () => {
  it("matches only a closed block and captures its thought", () => {
    const match = closedThinkBlockPattern().exec("<think>a</think> b");
    expect(match?.[0]).toBe("<think>a</think>");
    expect(match?.[1]).toBe("a");
  });

  it("returns a fresh pattern each time, so callers cannot share lastIndex", () => {
    expect(closedThinkBlockPattern()).not.toBe(closedThinkBlockPattern());
  });
});
