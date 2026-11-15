import type { LoopDetector } from "../loop/loopDetector.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { ToolCall } from "../tools/types.js";
import { logger } from "../utils/logger.js";

import { StreamCallbacks } from "./streamChatResponse.types.js";

export function trackFirstTokenTime(
  firstTokenTime: number | null,
  chunk: any,
  requestStartTime: number,
  model: any,
  tools?: any[],
): number | null {
  if (
    firstTokenTime === null &&
    chunk.choices?.[0]?.delta &&
    (chunk.choices[0].delta.content || chunk.choices[0].delta.tool_calls)
  ) {
    const tokenTime = Date.now();
    telemetryService.recordResponseTime(
      tokenTime - requestStartTime,
      model.model,
      "time_to_first_token",
      (tools?.length || 0) > 0,
    );
    return tokenTime;
  }
  return firstTokenTime;
}

/**
 * Hook stdout beyond the exit code. The reference delivers `additionalContext`
 * as its own meta message; the chat protocol requires every tool call to be
 * answered by exactly one tool message, so it rides inside that answer here,
 * in the reference's wording so a hook author sees its own text attributed.
 */

export function processChunkContent(
  content: string,
  aiResponse: string,
  callbacks?: StreamCallbacks,
  isHeadless?: boolean,
  /**
   * Fed each chunk so a repetition can be caught mid-message rather than after
   * paying for the whole round. See {@link processStreamingResponse} for where
   * the detector's result is consumed.
   */
  loopDetector?: LoopDetector,
): string {
  const updatedResponse = aiResponse + content;

  loopDetector?.feed(content);

  if (callbacks?.onContent) {
    callbacks.onContent(content);
  } else if (!isHeadless) {
    process.stdout.write(content);
  }

  return updatedResponse;
}

/**
 * Advances a streamed-arguments scan by one fragment and reports whether the
 * value closed. Only structural characters are counted: a brace inside a
 * string is data, not nesting.
 * @param scan - the state carried between fragments.
 * @param fragment - the newly arrived characters.
 * @returns true when the scan left the value complete.
 */
function scanArgumentFragment(
  scan: { depth: number; inString: boolean; escaped: boolean },
  fragment: string,
): boolean {
  let closed = false;
  for (const character of fragment) {
    if (scan.escaped) {
      scan.escaped = false;
    } else if (scan.inString) {
      if (character === "\\") scan.escaped = true;
      else if (character === '"') scan.inString = false;
    } else if (character === '"') {
      scan.inString = true;
    } else if (character === "{" || character === "[") {
      scan.depth += 1;
    } else if (character === "}" || character === "]") {
      scan.depth -= 1;
      if (scan.depth <= 0) closed = true;
    }
  }
  return closed;
}

// Helper function to handle tool call delta
export function processToolCallDelta(
  toolCallDelta: any,
  toolCallsMap: Map<string, ToolCall>,
  indexToIdMap: Map<number, string>,
): void {
  let toolCallId: string | undefined;

  // If we have an ID, use it and map the index
  if (toolCallDelta.id) {
    toolCallId = toolCallDelta.id;
    if (toolCallDelta.index !== undefined && toolCallId) {
      indexToIdMap.set(toolCallDelta.index, toolCallId);
    }
  } else if (toolCallDelta.index !== undefined) {
    // No ID, but we have an index - look up the ID from our map
    toolCallId = indexToIdMap.get(toolCallDelta.index);
    if (!toolCallId) {
      // Some providers (e.g. Ollama) stream tool-call deltas with an index
      // but no id. Generate a stable synthetic ID so the entry is created on
      // the first delta and later fragments accumulate instead of being
      // dropped as plain assistant text.
      toolCallId = `call_${toolCallDelta.index}`;
      indexToIdMap.set(toolCallDelta.index, toolCallId);
    }
  }

  if (!toolCallId) {
    logger.warn("Tool call delta without ID or valid index mapping", {
      toolCallDelta,
    });
    return;
  }

  // Create tool call entry if it doesn't exist
  if (!toolCallsMap.has(toolCallId)) {
    toolCallsMap.set(toolCallId, {
      id: toolCallId,
      name: "",
      arguments: {},
      argumentsStr: "",
      startNotified: false,
    });
  }

  const toolCall = toolCallsMap.get(toolCallId);
  if (!toolCall) {
    logger.warn("Tool call not found in map", { toolCallId });
    return;
  }

  // Update name
  if (toolCallDelta.function?.name) {
    toolCall.name = toolCallDelta.function.name;
  }

  // Accumulate arguments
  if (toolCallDelta.function?.arguments) {
    const fragment = toolCallDelta.function.arguments;
    toolCall.argumentsStr += fragment;
    const scan = toolCall.argScan ?? {
      depth: 0,
      inString: false,
      escaped: false,
    };
    toolCall.argScan = scan;
    // Parsing the growing buffer on every delta is quadratic in the argument
    // size, and every incomplete attempt throws. Parse once, on close.
    if (scanArgumentFragment(scan, fragment)) {
      try {
        toolCall.arguments = JSON.parse(toolCall.argumentsStr);
        toolCall.startNotified = true;
      } catch {
        // A truncated stream can close a fragment that is not valid JSON.
      }
    }
  }

  // Capture extra_content
  if (toolCallDelta.extra_content) {
    toolCall.extra_content = toolCallDelta.extra_content;
  }
}

// Helper function to detect provider from model name
