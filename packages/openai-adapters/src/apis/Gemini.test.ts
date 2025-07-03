import { describe, expect, it } from "vitest";

import { GeminiApi, splitGeminiApiBase } from "./Gemini.js";

describe("splitGeminiApiBase", () => {
  // The SDK composes <baseUrl>/<apiVersion>/..., so these two must be split
  // out of the single apiBase Continue stores. Getting this wrong either sends
  // custom endpoints to Google or duplicates the version in the path.
  it("splits the official endpoint", () => {
    expect(
      splitGeminiApiBase("https://generativelanguage.googleapis.com/v1beta/"),
    ).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiVersion: "v1beta",
    });
  });

  it("splits a local gateway endpoint", () => {
    expect(splitGeminiApiBase("http://127.0.0.1:3425/v1beta/")).toEqual({
      baseUrl: "http://127.0.0.1:3425",
      apiVersion: "v1beta",
    });
  });

  it("keeps a path prefix a gateway proxies under", () => {
    expect(splitGeminiApiBase("https://gw.example.com/proxy/v1beta/")).toEqual({
      baseUrl: "https://gw.example.com/proxy",
      apiVersion: "v1beta",
    });
  });

  it("recognises the stable version segment", () => {
    expect(
      splitGeminiApiBase("https://generativelanguage.googleapis.com/v1/"),
    ).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiVersion: "v1",
    });
  });

  it("falls back to the origin when there is no version segment", () => {
    expect(splitGeminiApiBase("http://localhost:11434/")).toEqual({
      baseUrl: "http://localhost:11434",
    });
  });
});

describe("GeminiApi", () => {
  const api = new GeminiApi({
    provider: "gemini",
    apiKey: "test-key",
  });

  describe("_convertBody merges consecutive same-role messages", () => {
    it("merges consecutive tool responses into a single user turn", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Use the tools" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "tool_a", arguments: "{}" },
                },
                {
                  id: "call_2",
                  type: "function" as const,
                  function: { name: "tool_b", arguments: "{}" },
                },
              ],
            },
            {
              role: "tool" as const,
              content: "result_a",
              tool_call_id: "call_1",
            },
            {
              role: "tool" as const,
              content: "result_b",
              tool_call_id: "call_2",
            },
          ],
        },
        true,
      );

      // Should be: user, model(functionCalls), user(functionResponses merged)
      expect(result.contents).toHaveLength(3);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[2].role).toBe("user");
      // Both function responses merged into one user turn
      expect(result.contents[2].parts).toHaveLength(2);
      expect(result.contents[2].parts[0]).toHaveProperty("functionResponse");
      expect(result.contents[2].parts[1]).toHaveProperty("functionResponse");
    });

    it("merges tool responses with following user message", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Use the tool" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "tool_a", arguments: "{}" },
                },
              ],
            },
            {
              role: "tool" as const,
              content: "result_a",
              tool_call_id: "call_1",
            },
            { role: "user", content: "Now do something else" },
          ],
        },
        true,
      );

      // tool response (user) + user message should merge
      expect(result.contents).toHaveLength(3);
      expect(result.contents[2].role).toBe("user");
      expect(result.contents[2].parts).toHaveLength(2);
    });

    it("merges consecutive model messages", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "First response" },
            { role: "assistant", content: "Second response" },
          ],
        },
        true,
      );

      // Two assistant messages should merge into one model message
      expect(result.contents).toHaveLength(2);
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[1].parts).toHaveLength(2);
    });

    it("preserves already-alternating messages unchanged", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there" },
            { role: "user", content: "How are you?" },
          ],
        },
        true,
      );

      expect(result.contents).toHaveLength(3);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[2].role).toBe("user");
    });
  });
});
