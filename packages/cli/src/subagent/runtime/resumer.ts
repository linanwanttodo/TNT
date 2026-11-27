import { updateSubagentRun, type SubagentRun } from "./spawner.js";

export function queueSubagentMessage(run: SubagentRun, message: string): void {
  const content = message.trim();
  if (!content) return;
  run.pendingMessages.push(content);
  updateSubagentRun(run.runId, { pendingMessages: run.pendingMessages });
}

export function takePendingMessages(run: SubagentRun): string[] {
  const pending = run.pendingMessages.splice(0);
  updateSubagentRun(run.runId, { pendingMessages: run.pendingMessages });
  return pending;
}
