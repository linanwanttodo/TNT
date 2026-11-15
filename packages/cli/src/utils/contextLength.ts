/**
 * How each vendor words "this request does not fit".
 *
 * The list is long on purpose. A refusal that is not recognised reads as a
 * generic API failure, so the turn dies instead of compacting and resending -
 * the one fault class where the agent can fix the input rather than report it.
 */
const CONTEXT_LENGTH_PATTERNS: readonly string[] = [
  // Anthropic Claude
  "input length and max_tokens exceed context limit",
  "decrease input length or max_tokens",
  "prompt is too long",
  // OpenAI
  "maximum context length",
  "reduce the length of the messages",
  // Mistral
  "tokens in the prompt exceeds",
  "use a shorter prompt",
  // Generic
  "context_length_exceeded",
];

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message ?? "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    return typeof message === "string" ? message : "";
  }
  return "";
}

/**
 * Whether an error says the request exceeded the model's context. Provider
 * payloads arrive as Errors, plain objects, or bare strings depending on the
 * adapter, and they quote parameter names inconsistently, so all three shapes
 * are read here and backticks are dropped rather than matched around.
 */
export function isContextLengthError(error: unknown): boolean {
  const message = messageOf(error).toLowerCase().replace(/`/g, "");
  if (!message) {
    return false;
  }

  // Some bodies only say invalid_request_error, with the context detail in a
  // nested field that surfaces as the word "context" in the text.
  if (
    message.includes("invalid_request_error") &&
    message.includes("context")
  ) {
    return true;
  }

  return CONTEXT_LENGTH_PATTERNS.some((pattern) => message.includes(pattern));
}
