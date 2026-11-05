import { useState } from "react";

import type { SubagentState } from "../../../types/agent-events.js";
import { ShellIcon } from "../icons.tsx";
import css from "../WorkspaceRail.module.css";

function AgentCard({ agent }: { agent: SubagentState }) {
  const [open, setOpen] = useState(agent.status === "running");
  const hasBody = agent.prompt !== "" || agent.content !== undefined;
  return (
    <div className={css.approval}>
      <button
        type="button"
        className={css.agentToggle}
        aria-expanded={open}
        disabled={!hasBody}
        onClick={() => setOpen((value) => !value)}
      >
        {hasBody ? (
          <ShellIcon
            glyph="arrow-right"
            size={10}
            className={css.agentCaret}
            data-open={open}
          />
        ) : null}
        <span>{agent.name}</span>
        <span className={css.agentStatus} data-status={agent.status}>
          {agent.status}
        </span>
      </button>
      {open ? (
        <>
          {agent.prompt ? <div className={css.agentPrompt}>{agent.prompt}</div> : null}
          {agent.content ? <div className={css.agentContent}>{agent.content}</div> : null}
          {agent.status === "finished" ? (
            <div className={css.agentStatusLine} data-success={agent.success}>
              {agent.success ? "Success" : "Failed"}
              {agent.verdict ? ` · ${agent.verdict}` : ""}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function SubagentsPanel({ subagents }: { subagents: SubagentState[] }) {
  if (subagents.length === 0) {
    return <div className={css.muted}>No subagents</div>;
  }
  return (
    <div>
      <div className={css.sectionTitle}>Subagents</div>
      {subagents.map((agent) => (
        <AgentCard key={agent.name} agent={agent} />
      ))}
    </div>
  );
}
