import { describe, expect, it } from "vitest";

import { isContextLengthError } from "./contextLength.js";

describe("isContextLengthError", () => {
  it("matches the phrasings vendors actually use", () => {
    const messages = [
      "400 prompt is too long: 210000 tokens > 200000 maximum",
      "This model's maximum context length is 8192 tokens, however you requested 12000",
      "Please reduce the length of the messages or completion",
      "400 invalid_request_error: input length and `max_tokens` exceed context limit",
      "decrease input length or `max_tokens`",
      "The number of tokens in the prompt exceeds the model context",
      "please use a shorter prompt",
      "context_length_exceeded",
    ];

    for (const message of messages) {
      expect(isContextLengthError(new Error(message))).toBe(true);
    }
  });

  it("reads the message on a plain object as well as on an Error", () => {
    expect(isContextLengthError({ message: "prompt is too long" })).toBe(true);
    expect(isContextLengthError("prompt is too long")).toBe(true);
  });

  it("does not claim every failure is a context problem", () => {
    expect(isContextLengthError(new Error("invalid api key"))).toBe(false);
    expect(isContextLengthError(new Error("429 rate limit exceeded"))).toBe(
      false,
    );
    // invalid_request_error alone is a hundred different refusals.
    expect(
      isContextLengthError(new Error("400 invalid_request_error: bad model")),
    ).toBe(false);
    expect(isContextLengthError(undefined)).toBe(false);
    expect(isContextLengthError(null)).toBe(false);
  });
});
