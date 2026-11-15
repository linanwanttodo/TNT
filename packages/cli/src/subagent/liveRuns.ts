/**
 * A process-wide count of subagent dispatches in flight. The runtime context
 * note tells the model what it is already running in parallel with, and the
 * only honest source is the dispatch lifecycle itself: `executeSubAgent` notes
 * a run the moment it starts and closes it in its finally, so a crash still
 * unregisters. Counting is read per user message, never per request.
 */
interface LiveRun {
  agentType: string;
  startedAt: number;
}

const runs = new Map<string, LiveRun>();
let sequence = 0;

export function noteSubagentRunStarted(agentType: string): string {
  sequence += 1;
  const id = `live-run-${sequence}`;
  runs.set(id, { agentType, startedAt: Date.now() });
  return id;
}

export function noteSubagentRunFinished(id: string): void {
  runs.delete(id);
}

export interface LiveRunSummary {
  count: number;
  /** Dispatches grouped by agent type, only for types with at least one run. */
  byType: Record<string, number>;
  /** How long the longest-running dispatch has been alive, when any is. */
  longestMs: number | undefined;
}

export function liveSubagentRuns(): LiveRunSummary {
  const byType: Record<string, number> = {};
  let longestMs: number | undefined;
  const now = Date.now();
  for (const run of runs.values()) {
    byType[run.agentType] = (byType[run.agentType] ?? 0) + 1;
    const alive = now - run.startedAt;
    longestMs = longestMs === undefined ? alive : Math.max(longestMs, alive);
  }
  return { count: runs.size, byType, longestMs };
}

/** Test seam: forget every live run, so cases cannot leak into each other. */
export function clearLiveSubagentRuns(): void {
  runs.clear();
  sequence = 0;
}
