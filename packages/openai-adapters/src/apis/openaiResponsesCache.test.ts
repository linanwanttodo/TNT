import { afterEach, describe, expect, it, vi } from "vitest";

import { isResponsesModel, toResponsesParams } from "./openaiResponses.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(model: string) {
  return toResponsesParams({
    model,
    messages: [
      { role: "system", content: "stable instructions" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "newest question" },
    ],
  } as any) as any;
}

function markedParts(body: any): any[] {
  return (body.input as any[])
    .filter((item) => Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((part) => part.prompt_cache_breakpoint === true);
}

describe("Responses prompt caching", () => {
  it("asks for explicit breakpoints with the short ttl on GPT-5.6 and later", () => {
    const body = request("gpt-5.6-sol");

    expect(body.prompt_cache_options).toEqual({
      mode: "explicit",
      ttl: "30m",
    });
    expect(markedParts(body)).toHaveLength(2);
  });

  it("extends the ttl to twelve hours in long mode", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "long");

    const body = request("gpt-5.6-sol");
    expect(body.prompt_cache_options).toEqual({
      mode: "explicit",
      ttl: "12h",
    });
  });

  it("leaves an older model to the provider's implicit cache", () => {
    const body = request("gpt-5");

    expect(body.prompt_cache_options).toBeUndefined();
    expect(markedParts(body)).toEqual([]);
  });

  it("sends nothing when retention is none", () => {
    vi.stubEnv("CONTINUE_CLI_CACHE_RETENTION", "none");

    const body = request("gpt-5.6-sol");
    expect(body.prompt_cache_options).toBeUndefined();
    expect(markedParts(body)).toEqual([]);
  });

  it("marks the stable head and the newest turn, and never tool output", () => {
    const body = toResponsesParams({
      model: "gpt-5.6-sol",
      messages: [
        { role: "system", content: "stable instructions" },
        { role: "user", content: "question" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "Read", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "file contents" },
      ],
    } as any) as any;

    const output = (body.input as any[]).find(
      (item) => item.type === "function_call_output",
    );
    expect(output).toBeDefined();
    expect(output).not.toHaveProperty("prompt_cache_breakpoint");

    const marked = (body.input as any[]).filter((item) =>
      Array.isArray(item.content)
        ? item.content.some((part: any) => part.prompt_cache_breakpoint)
        : false,
    );
    expect(marked.map((item) => item.role)).toEqual(["developer", "user"]);
  });

  it("does not mark an image-only turn as a breakpoint", () => {
    const body = toResponsesParams({
      model: "gpt-5.6-sol",
      messages: [
        { role: "system", content: "stable instructions" },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://example.com/image.png" },
            },
          ],
        },
      ],
    } as any) as any;

    const newest = (body.input as any[]).at(-1);
    expect(newest.role).toBe("user");
    expect(
      newest.content.some((part: any) => part.prompt_cache_breakpoint),
    ).toBe(false);
    expect(markedParts(body)).toHaveLength(1);
  });
});

describe("isResponsesModel", () => {
  it("routes every GPT-5 and later model through the Responses API", () => {
    for (const model of ["gpt-5", "gpt-5-codex", "gpt-5.6-sol", "gpt-6.1"]) {
      expect(isResponsesModel(model), model).toBe(true);
    }
  });

  it("keeps earlier models on chat completions", () => {
    for (const model of ["gpt-4o", "gpt-4.1", "claude-sonnet"]) {
      expect(isResponsesModel(model), model).toBe(false);
    }
  });
});
