import type { ChatHistoryItem } from "core/index.js";
import { useEffect, useRef, useState } from "react";

import { getSessionUsage } from "../../session/index.js";
import { formatTokens } from "../utils/contextReadout.js";

interface Totals {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  cost: number;
  rounds: number;
}

function totalsNow(): Totals {
  const usage = getSessionUsage();
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cachedTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
    cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0,
    cost: usage.totalCost,
    rounds: usage.reportedUsageRequests ?? 0,
  };
}

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A turn-end line based on the session's cumulative usage delta. The provider
 * numbers are authoritative; no chars/4 estimate is used for turn accounting.
 */
export function useTurnSummary(
  isWaiting: boolean,
  responseStartTime: number | null,
  chatHistory: ChatHistoryItem[],
): string | undefined {
  const [summary, setSummary] = useState<string>();
  const baseline = useRef<Totals | null>(null);
  const turnStart = useRef<number | null>(null);
  const historyStart = useRef(0);
  const previousWaiting = useRef(false);

  useEffect(() => {
    if (isWaiting && !previousWaiting.current) {
      baseline.current = totalsNow();
      turnStart.current = responseStartTime ?? Date.now();
      historyStart.current = chatHistory.length;
      setSummary(undefined);
    } else if (!isWaiting && previousWaiting.current && baseline.current) {
      const current = totalsNow();
      const before = baseline.current;
      const input = Math.max(0, current.promptTokens - before.promptTokens);
      const output = Math.max(
        0,
        current.completionTokens - before.completionTokens,
      );
      const cached = Math.max(0, current.cachedTokens - before.cachedTokens);
      const cacheWrite = Math.max(
        0,
        current.cacheWriteTokens - before.cacheWriteTokens,
      );
      const cost = Math.max(0, current.cost - before.cost);
      const rounds = Math.max(0, current.rounds - before.rounds);
      const tools = chatHistory
        .slice(historyStart.current)
        .reduce((total, item) => total + (item.toolCallStates?.length ?? 0), 0);
      const parts = [
        `${formatTokens(input + output)} tokens`,
        elapsedLabel(Date.now() - (turnStart.current ?? Date.now())),
        `${rounds} 轮`,
        `${tools} 工具`,
      ];
      if (cached > 0) {
        const rate = Math.round(
          (cached / Math.max(1, input + cached + cacheWrite)) * 100,
        );
        parts.push(`本轮缓存 ${rate}%`);
      }
      if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
      setSummary(parts.join(" · "));
      baseline.current = null;
      turnStart.current = null;
    }
    previousWaiting.current = isWaiting;
  }, [isWaiting, responseStartTime, chatHistory]);

  return summary;
}
