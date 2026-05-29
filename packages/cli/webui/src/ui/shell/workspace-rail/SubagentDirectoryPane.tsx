import { useSessionStore } from "../../../stores/session-store.js";
import { useSidePaneStore } from "../../../stores/side-pane-store.js";
import type { SubagentState } from "../../../types/agent-events.js";
import css from "../WorkspaceRail.module.css";

/**
 * The subagent directory, ported from ZCode's SubagentDirectorySidePane: one
 * row per run this session dispatched, status icon leading, summary line
 * under the title, relative time trailing. Clicking a row opens the run's
 * own tab.
 */
function DirectoryRow({ agent }: { agent: SubagentState }) {
  const openTab = useSidePaneStore((state) => state.openTab);
  const summary =
    agent.content?.split("\n").find((line) => line.trim() !== "") ??
    agent.prompt.split("\n").find((line) => line.trim() !== "") ??
    "";

  return (
    <button
      type="button"
      className={css.directoryRow}
      onClick={() =>
        openTab({ kind: "subagent", title: agent.name, path: agent.name })
      }
    >
      <span className={css.directoryStatus} data-kind={agent.status}>
        {agent.status === "running" ? (
          <span className={css.directorySpinner} aria-label="Running" />
        ) : agent.success ? (
          "✓"
        ) : (
          "✕"
        )}
      </span>
      <span className={css.directoryBody}>
        <span className={css.directoryTitleRow}>
          <span className={css.directoryTitle}>{agent.name}</span>
          <span className={css.directoryState} data-kind={agent.status}>
            {agent.status === "running"
              ? "Running"
              : agent.success
                ? "Success"
                : "Failed"}
          </span>
        </span>
        {summary ? (
          <span className={css.directorySummary}>{summary}</span>
        ) : null}
      </span>
      {agent.startedAt ? (
        <span className={css.directoryTime}>
          {new Date(agent.startedAt).toLocaleTimeString()}
        </span>
      ) : null}
    </button>
  );
}

export function SubagentDirectoryPane() {
  const subagents = useSessionStore((state) => state.subagents);
  if (subagents.length === 0) {
    return (
      <div className={css.muted}>
        No agents dispatched yet. Delegated runs show up here.
      </div>
    );
  }
  return (
    <div>
      <div className={css.sectionTitle}>Agents</div>
      <div className={css.directory}>
        {subagents.map((agent) => (
          <DirectoryRow key={agent.name} agent={agent} />
        ))}
      </div>
    </div>
  );
}
