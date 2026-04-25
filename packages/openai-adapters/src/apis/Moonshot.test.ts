import { describe, expect, it, vi } from "vitest";

import { fetchwithRequestOptions } from "@tnt/fetch";

import { MoonshotApi } from "./Moonshot.js";

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

function mockFimFetch() {
  const mock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        sseStream([{ choices: [{ delta: { content: "fib(a - 1)" } }] }]),
        { headers: { "Content-Type": "application/event-stream" } },
      ),
    );
  vi.mocked(fetchwithRequestOptions).mockImplementation(mock as any);
  return mock;
}

async function runFim(api: MoonshotApi) {
  const stream = api.fimStream(
    {
      model: "kimi-k3",
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
}

describe("MoonshotApi", () => {
  it("sends the fill-in-the-middle prompt through chat completions with the [fill] marker", async () => {
    const mock = mockFimFetch();
    const api = new MoonshotApi({ provider: "moonshot", apiKey: "key" } as any);

    await runFim(api);

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url.toString()).toBe("https://api.moonshot.cn/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "kimi-k3",
      messages: [
        { role: "user", content: "def fib(a):[fill]    return fib(a - 1)" },
      ],
      max_tokens: 128,
      temperature: 0.2,
      top_p: 0.9,
      stop: ["</code>"],
      stream: true,
    });
  });

  it("keeps a configured apiBase instead of falling back to the default", async () => {
    const mock = mockFimFetch();
    const api = new MoonshotApi({
      provider: "moonshot",
      apiKey: "key",
      apiBase: "https://api.moonshot.ai/v1/",
    } as any);

    await runFim(api);

    const [url] = mock.mock.calls[0];
    expect(url.toString()).toBe("https://api.moonshot.ai/v1/chat/completions");
  });
});
