import { describe, expect, it, vi } from "vitest";

import { DeepSeekApi } from "./DeepSeek.js";
import { fetchwithRequestOptions } from "@tnt/fetch";

vi.mock("@tnt/fetch", async () => {
  const actual = await vi.importActual("@tnt/fetch");
  return {
    ...actual,
    fetchwithRequestOptions: vi.fn(),
  };
});

function sseStream(chunks: any[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
        );
      }
      controller.close();
    },
  });
}

function mockFetchOnce() {
  const mock = vi.fn().mockResolvedValue(
    new Response(sseStream([{ choices: [{ text: "def fib(a):" }] }]), {
      headers: { "Content-Type": "application/event-stream" },
    }),
  );
  vi.mocked(fetchwithRequestOptions).mockImplementation(mock as any);
  return mock;
}

describe("DeepSeekApi", () => {
  it("sends fill-in-the-middle to the beta endpoint the docs name", async () => {
    const mock = mockFetchOnce();
    const api = new DeepSeekApi({ provider: "deepseek", apiKey: "key" } as any);

    const stream = api.fimStream(
      {
        model: "deepseek-v4-pro",
        prompt: "def fib(a):",
        suffix: "    return fib(a - 1)",
        max_tokens: 128,
        temperature: 0.2,
        top_p: 0.9,
        frequency_penalty: 1,
        presence_penalty: 1,
        stop: ["</code>"],
        stream: true,
      } as any,
      new AbortController().signal,
    );
    for await (const _ of stream) {
      // consume the response so the request is made
    }

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url.toString()).toBe("https://api.deepseek.com/beta/completions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "deepseek-v4-pro",
      prompt: "def fib(a):",
      suffix: "    return fib(a - 1)",
      max_tokens: 128,
      temperature: 0.2,
      top_p: 0.9,
      stop: ["</code>"],
      stream: true,
    });
  });

  it("leaves out the penalty fields the endpoint no longer supports", async () => {
    const mock = mockFetchOnce();
    const api = new DeepSeekApi({ provider: "deepseek", apiKey: "key" } as any);

    const stream = api.fimStream(
      {
        model: "deepseek-v4-pro",
        prompt: "a",
        suffix: "b",
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        stream: true,
      } as any,
      new AbortController().signal,
    );
    for await (const _ of stream) {
      // consume the response so the request is made
    }

    const [, init] = mock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("frequency_penalty");
    expect(body).not.toHaveProperty("presence_penalty");
  });

  it("sends the fill-in-the-middle request to a configured endpoint", async () => {
    const mock = mockFetchOnce();
    const api = new DeepSeekApi({
      provider: "deepseek",
      apiKey: "key",
      apiBase: "https://proxy.example.com/deepseek/",
    } as any);

    const stream = api.fimStream(
      {
        model: "deepseek-v4-pro",
        prompt: "a",
        suffix: "b",
        stream: true,
      } as any,
      new AbortController().signal,
    );
    for await (const _ of stream) {
      // consume the response so the request is made
    }

    const [url] = mock.mock.calls[0];
    expect(url.toString()).toBe(
      "https://proxy.example.com/deepseek/beta/completions",
    );
  });
});
