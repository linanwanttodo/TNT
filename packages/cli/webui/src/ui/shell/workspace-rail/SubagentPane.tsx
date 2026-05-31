import type { SubagentState } from "../../../types/agent-events.js";
import { useSessionStore } from "../../../stores/session-store.js";
import css from "../WorkspaceRail.module.css";

/**
 * One subagent's session, as a side-pane tab shows it: the prompt it ran
 * with, its output so far, and the verdict once it finishes. The agent lives
 * in the session store, so the tab tracks it live.
 */
export function SubagentPane({ agentName }: { agentName: string }) {
  const agent: SubagentState | undefined = useSessionStore((state) =>
    state.subagents.find((candidate) => candidate.name === agentName),
  );

  if (!agent) {
    return (
      <div className={css.muted}>
        {agentName} is no longer in this session's roster.
      </div>
    );
  }

  return (
    <div>
      <div className={css.sectionTitle}>{agent.name}</div>
      <div
        className={css.agentStatusLine}
        data-success={agent.status === "finished" ? agent.success : undefined}
      >
        <span className={css.agentStatus} data-status={agent.status}>
          {agent.status}
        </span>
      </div>
      {agent.prompt ? (
        <div className={css.agentPrompt}>{agent.prompt}</div>
      ) : null}
      {agent.content ? (
        <div className={css.agentContent}>{agent.content}</div>
      ) : null}
      {agent.status === "finished" ? (
        <div className={css.agentStatusLine} data-success={agent.success}>
          {agent.success ? "Success" : "Failed"}
          {agent.verdict ? ` · ${agent.verdict}` : ""}
        </div>
      ) : null}
    </div>
  );
}
