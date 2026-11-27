import { t } from "../../i18n/index.js";
import { publishAgentEvent } from "../../protocol/eventBus.js";

import { updateSubagentRun, type SubagentRun } from "./spawner.js";

export function requestParentInput(run: SubagentRun, message: string): void {
  const content = message.trim();
  if (!content) throw new Error(t("subagent.parentInputMessageRequired"));
  updateSubagentRun(run.runId, { status: "waiting_input" });
  run.abortController.abort();
  publishAgentEvent({
    type: "subagent.ping",
    sessionId: run.parentSessionId,
    turnId: run.runId,
    seq: 1,
    timestamp: Date.now(),
    agentName: run.agentType,
    childSessionId: run.sessionId,
    content,
  });
}
