import type { SessionUsage } from "core/index.js";

import type { StreamCallbacks } from "../stream/streamChatResponse.types.js";

/** Receives one complete NDJSON line, including its trailing newline. */
export type StreamJsonWriter = (line: string) => void;

/**
 * Renders the stream callbacks as newline-delimited JSON: one object per line,
 * each tagged with a `type`, so a CI job can consume a headless run as events
 * instead of waiting for a single blob at the end. Every value is passed
 * through JSON.stringify, so content with newlines cannot break the
 * one-object-per-line contract.
 */
export function createStreamJsonCallbacks(
  write: StreamJsonWriter,
): StreamCallbacks {
  const emit = (event: Record<string, unknown>): void => {
    write(JSON.stringify(event) + "\n");
  };
  return {
    onContentComplete: (content) => emit({ type: "assistant", content }),
    onToolStart: (toolName, toolArgs) =>
      emit({ type: "tool-start", tool: toolName, arguments: toolArgs }),
    onToolResult: (result, toolName, status) =>
      emit({ type: "tool-result", tool: toolName, status, result }),
    onToolError: (error, toolName) =>
      emit({ type: "tool-error", tool: toolName, error }),
    onTurnTerminated: (reason, detail) =>
      emit({ type: "turn-end", reason, notice: detail?.notice }),
  };
}

/**
 * The final line of a successful stream-json run. It carries the final text
 * and the session usage, so a consumer that only reads the last line still
 * learns what the run cost without replaying the event stream.
 */
export function streamJsonResultLine(
  finalResponse: string,
  usage: SessionUsage,
): string {
  return (
    JSON.stringify({
      type: "result",
      subtype: "success",
      content: finalResponse,
      usage,
    }) + "\n"
  );
}

/**
 * The final line of a failed run. A stream-json stream always ends with a
 * result line, so a consumer can tell a truncated stream from a failed run.
 */
export function streamJsonErrorLine(message: string): string {
  return (
    JSON.stringify({ type: "result", subtype: "error", error: message }) + "\n"
  );
}
