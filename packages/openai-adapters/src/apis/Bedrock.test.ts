import { describe, expect, it } from "vitest";

import { BedrockApi } from "./Bedrock.js";

const EVENTS = [
  { contentBlockDelta: { delta: { text: "hel" } } },
  { contentBlockDelta: { delta: { text: "lo" } } },
  {
    metadata: { usage: { inputTokens: 21, outputTokens: 7, totalTokens: 28 } },
  },
];

function bedrock(events: any[]): any {
  const api: any = Object.create(BedrockApi.prototype);
  // The conversion from OpenAI shape to ConverseStream input is not under test
  // here, and the client is the only thing the stream loop touches.
  api._convertBody = () => ({});
  api.getClient = async () => ({
    send: async () => ({
      stream: (async function* () {
        for (const event of events) yield event;
      })(),
    }),
  });
  return api;
}

const body = {
  model: "anthropic.claude-3-haiku",
  messages: [{ role: "user", content: "hi" }],
} as any;

describe("the trailing metadata event of a Bedrock chat stream", () => {
  it("turns its token counts into a usage chunk", async () => {
    const api = bedrock(EVENTS);
    const chunks: any[] = [];
    for await (const chunk of api.chatCompletionStream(
      body,
      new AbortController().signal,
    )) {
      chunks.push(chunk);
    }

    expect(
      chunks.map((chunk) => chunk.choices[0]?.delta?.content).join(""),
    ).toBe("hello");
    expect(chunks[chunks.length - 1].usage).toEqual({
      prompt_tokens: 21,
      completion_tokens: 7,
      total_tokens: 28,
    });
  });

  it("carries those counts into the aggregated non-streaming response", async () => {
    const api = bedrock(EVENTS);

    const response = await api.chatCompletionNonStream(
      body,
      new AbortController().signal,
    );

    expect(response.choices[0].message.content).toBe("hello");
    expect(response.usage).toEqual({
      prompt_tokens: 21,
      completion_tokens: 7,
      total_tokens: 28,
    });
  });
});
