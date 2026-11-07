import { useEffect, useState } from "react";

import { fetchTeam, type TeamResponse } from "../../../api/client.js";
import { useSidePaneStore } from "../../../stores/side-pane-store.js";
import { useSessionStore } from "../../../stores/session-store.js";
import css from "../WorkspaceRail.module.css";

/**
 * The team panel, ZCode's workflow side pane adapted to TNT's team rosters:
 * the active team runs as the header, its members as actor rows, each one
 * clickable into a live subagent tab when a dispatch with that name exists.
 */
function TeamMemberRow({
  member,
  liveAgent,
}: {
  member: TeamResponse["teams"][number]["members"][number];
  liveAgent: { status: string; success?: boolean } | undefined;
}) {
  const openTab = useSidePaneStore((state) => state.openTab);
  const openSubagent = () =>
    openTab({ kind: "subagent", title: member.name, path: member.name });

  return (
    <button
      type="button"
      className={css.teamMemberRow}
      onClick={liveAgent ? openSubagent : undefined}
      title={liveAgent ? `Open ${member.name}` : undefined}
      data-live={liveAgent !== undefined}
    >
      <span className={css.teamMemberBody}>
        <span className={css.teamMemberTitleRow}>
          <span className={css.teamMemberName}>{member.name}</span>
          {member.lead ? (
            <span className={css.teamMemberLead}>Lead</span>
          ) : null}
          {liveAgent ? (
            <span className={css.teamMemberLive} data-status={liveAgent.status}>
              {liveAgent.status === "running"
                ? "Running"
                : liveAgent.success
                  ? "Success"
                  : "Failed"}
            </span>
          ) : null}
        </span>
        {member.description ? (
          <span className={css.teamMemberDescription}>
            {member.description}
          </span>
        ) : null}
      </span>
      <span className={css.teamMemberSource}>{member.source}</span>
    </button>
  );
}

export function TeamPane() {
  const subagents = useSessionStore((state) => state.subagents);
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTeam()
      .then((result) => {
        if (!cancelled) setTeam(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div className={css.muted} role="alert">
        {error}
      </div>
    );
  }
  if (team === null) {
    return <div className={css.muted}>Loading teams...</div>;
  }
  if (team.teams.length === 0) {
    return (
      <div className={css.muted}>
        No team rosters. Create one with /team create in the CLI.
      </div>
    );
  }

  const active = team.teams.find((entry) => entry.active) ?? null;
  return (
    <div>
      {active ? (
        <>
          <div className={css.sectionTitle}>{active.name}</div>
          <div className={css.teamMembers}>
            {active.members.map((member) => (
              <TeamMemberRow
                key={member.name}
                member={member}
                liveAgent={subagents.find(
                  (agent) => agent.name === member.name,
                )}
              />
            ))}
          </div>
        </>
      ) : null}
      {team.teams.filter((entry) => !entry.active).length > 0 ? (
        <>
          <div className={css.sectionTitle}>Other rosters</div>
          <div className={css.teamMembers}>
            {team.teams
              .filter((entry) => !entry.active)
              .map((entry) => (
                <div key={entry.name} className={css.teamMemberRow}>
                  <span className={css.teamMemberBody}>
                    <span className={css.teamMemberTitleRow}>
                      <span className={css.teamMemberName}>{entry.name}</span>
                      <span className={css.teamMemberMeta}>
                        {entry.members.length} members
                      </span>
                    </span>
                  </span>
                  <span className={css.teamMemberSource}>inactive</span>
                </div>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
