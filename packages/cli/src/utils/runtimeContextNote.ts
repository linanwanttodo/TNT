import type { ModelConfig } from "@tnt/config-yaml";

import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import { measuredRequestFor } from "../compaction/measuredContext.js";
import { getSessionTeamRuns } from "../session/index.js";
import { liveSubagentRuns } from "../subagent/liveRuns.js";
import { getModelContextLimit } from "./tokenizer.js";

/**
 * What the model cannot see about its own session, said once per user message:
 * the wall clock it is working against, how much of the context window the
 * conversation already fills, and what is still running in parallel. The note
 * rides in the newest user message after the cached prefix, so it costs one
 * line and never rewrites the part a provider caches.
 *
 * Each segment appears only when it can be said honestly. The context segment
 * uses the provider's own measurement of the last request under this prefix
 * and stays quiet before one exists - a local recount of the whole history on
 * every message is exactly the work the budget note refuses. The task segment
 * stays quiet when nothing runs, so a plain conversation carries only the
 * clock.
 */

/** Rounded to the hundred, because every number here is an estimate either way. */
function rounded(tokens: number): number {
  return Math.max(0, Math.round(tokens / 100) * 100);
}

export function clockSegment(now: Date): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRest = Math.abs(offsetMinutes) % 60;
  const zone = `UTC${sign}${offsetHours}${
    offsetRest === 0 ? "" : `:${String(offsetRest).padStart(2, "0")}`
  }`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  return `Local time: ${local}, ${weekday} (${zone}, ${periodOfDay(now.getHours())})`;
}

function periodOfDay(hour: number): string {
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function contextSegment(model: ModelConfig | undefined): string | undefined {
  if (!model) return undefined;
  const measured = measuredRequestFor(currentPromptCacheKey())?.promptTokens;
  if (measured === undefined) return undefined;
  const limit = getModelContextLimit(model);
  if (limit <= 0) return undefined;
  const percent = Math.min(100, Math.round((measured / limit) * 100));
  return `Context window: about ${rounded(measured)} of ${rounded(limit)} tokens used (${percent}%)`;
}

function tasksSegment(): string | undefined {
  const parts: string[] = [];
  const live = liveSubagentRuns();
  if (live.count > 0) {
    parts.push(
      live.count === 1
        ? `1 subagent dispatch running (${Object.keys(live.byType).join(", ")})`
        : `${live.count} subagent dispatches running (${Object.entries(
            live.byType,
          )
            .map(([type, count]) => `${count} ${type}`)
            .join(", ")})`,
    );
  }
  const running = getSessionTeamRuns().filter(
    (run) => run.status === "running",
  );
  for (const run of running) {
    const members = run.members.filter((member) => member.status === "running");
    parts.push(
      `team "${run.team}" run active (${members.length} of ${run.members.length} members working, mode ${run.mode})`,
    );
  }
  if (parts.length === 0) return undefined;
  return `Running now: ${parts.join("; ")}`;
}

export function runtimeContextNote(input: {
  model?: ModelConfig;
  now?: Date;
}): string {
  const segments = [
    clockSegment(input.now ?? new Date()),
    contextSegment(input.model),
    tasksSegment(),
  ].filter((segment): segment is string => Boolean(segment));
  return `Runtime context: ${segments.join(" ")}`;
}
