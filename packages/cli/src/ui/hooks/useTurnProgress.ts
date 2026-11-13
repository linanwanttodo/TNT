import type { ChatHistoryItem } from "core/index.js";
import { useRef } from "react";

import { peekTurnUsage } from "../../stream/usageTelemetry.js";

/**
 * What one user turn has done so far, read while it streams.
 *
 * The provider's numbers are authoritative and arrive at the end of each
 * round; between rounds the visible output is the only signal for the current
 * one, so `streamingTokens` keeps the output count moving without inventing
 * input tokens that were never measured.
 */
export interface TurnProgress {
  /** Tool calls started since this turn began. */
  toolCalls: number;
  /** Provider rounds that have completed; each one is a model step. */
  steps: number;
  inputTokens: number;
  outputTokens: number;
  /** Share of this turn's prompt the provider already had, 0..1. */
  cacheRate?: number;
  cost: number;
}

export function useTurnProgress(input: {
  isWaiting: boolean;
  /** Changes once per turn; used as the boundary marker. */
  responseStartTime: number | null;
  chatHistory: ChatHistoryItem[];
  /** Estimated output tokens of the round that is still streaming. */
  streamingTokens: number;
}): TurnProgress | undefined {
  const historyStart = useRef(0);
  const seenStart = useRef<number | null>(null);

  // A turn begins when the terminal receives a start time it has not seen. The
  // check runs during render so the first painted frame already counts from
  // the right history offset.
  if (!input.isWaiting) {
    seenStart.current = null;
  } else if (seenStart.current !== input.responseStartTime) {
    seenStart.current = input.responseStartTime;
    historyStart.current = input.chatHistory.length;
  }

  if (!input.isWaiting) {
    return undefined;
  }

  const usage = peekTurnUsage();
  const toolCalls = input.chatHistory
    .slice(historyStart.current)
    .reduce((total, item) => total + (item.toolCallStates?.length ?? 0), 0);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = (usage?.outputTokens ?? 0) + input.streamingTokens;
  const cacheRead = usage?.cacheReadTokens ?? 0;
  const cacheRate = inputTokens > 0 ? cacheRead / inputTokens : undefined;

  return {
    toolCalls,
    steps: usage?.rounds ?? 0,
    inputTokens,
    outputTokens,
    cacheRate,
    cost: usage?.cost ?? 0,
  };
}
