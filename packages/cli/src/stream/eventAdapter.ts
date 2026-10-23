import type { ToolStatus } from "core/index.js";

import {
  createEventSequence,
  type AgentEvent,
  type AgentEventInput,
} from "../protocol/events.js";

import type { StreamCallbacks } from "./streamChatResponse.types.js";

export interface AgentEventStreamOptions {
  sessionId: string;
  turnId: string;
  /** The consumer's sink. The controller publishes here. */
  emit: (event: AgentEvent) => void;
  now?: () => number;
}

export interface AgentEventStream {
  /** Emit an event the stream callbacks cannot produce themselves. */
  publish: (event: AgentEventInput) => AgentEvent;
  callbacks: (inner?: StreamCallbacks) => StreamCallbacks;
  lastSeq: () => number;
}

/**
 * Turns the engine's callback surface into the event contract.
 *
 * The callbacks stay the engine seam - they are what `streamChatResponse`
 * already knows how to call - and this adapter is the one place that knows how
 * each callback maps to an event. A surface can therefore subscribe to the
 * contract without the engine importing the protocol.
 */
export function createAgentEventStream(
  options: AgentEventStreamOptions,
): AgentEventStream {
  const sequence = createEventSequence(
    options.sessionId,
    options.turnId,
    options.now,
  );

  const publish = (event: AgentEventInput) => {
    const stamped = sequence.next(event);
    options.emit(stamped);
    return stamped;
  };

  const callbacks = (inner?: StreamCallbacks): StreamCallbacks => ({
    ...inner,

    onContent: (content) => {
      publish({ type: "content.delta", delta: content });
      inner?.onContent?.(content);
    },

    onReasoning: (delta) => {
      publish({ type: "reasoning.delta", delta });
      inner?.onReasoning?.(delta);
    },

    onToolStart: (toolName, toolArgs, toolCallId) => {
      publish({
        type: "tool.started",
        toolName,
        args: toolArgs,
        toolCallId,
      });
      inner?.onToolStart?.(toolName, toolArgs, toolCallId);
    },

    onToolUpdate: (update) => {
      publish({
        type: "tool.updated",
        toolCallId: update.toolCallId,
        toolName: update.toolName,
        status: update.status,
      });
      inner?.onToolUpdate?.(update);
    },

    onToolResult: (result, toolName, status, toolCallId) => {
      publish({
        type: "tool.finished",
        toolName,
        status,
        result,
        toolCallId,
      });
      inner?.onToolResult?.(result, toolName, status, toolCallId);
    },

    onToolError: (error, toolName) => {
      publish({
        type: "tool.finished",
        toolName: toolName ?? "unknown",
        status: "errored" satisfies ToolStatus,
        result: error,
      });
      inner?.onToolError?.(error, toolName);
    },

    onToolPermissionRequest: (
      toolName,
      toolArgs,
      requestId,
      preview,
      toolCallId,
    ) => {
      publish({
        type: "permission.requested",
        requestId,
        toolCallId,
        toolName,
        toolArgs,
        preview,
      });
      inner?.onToolPermissionRequest?.(
        toolName,
        toolArgs,
        requestId,
        preview,
        toolCallId,
      );
    },

    onSystemMessage: (message) => {
      publish({ type: "notice", message });
      inner?.onSystemMessage?.(message);
    },
  });

  return {
    publish,
    callbacks,
    lastSeq: sequence.lastSeq,
  };
}
