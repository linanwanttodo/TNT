import type { TeamBrief } from "core/index.js";

import { publishAgentEvent } from "../protocol/eventBus.js";
import {
  appendTeamBrief,
  getCurrentSession,
  getTeamRunSessionId,
} from "../session/index.js";

export interface TeamBriefInput {
  teamRunId: string;
  from: string;
  to: string;
  type: TeamBrief["type"];
  content: string;
}

export function shareTeamBrief(input: TeamBriefInput): TeamBrief | undefined {
  const brief = appendTeamBrief(input.teamRunId, {
    from: input.from,
    to: input.to,
    type: input.type,
    content: input.content,
  });
  if (!brief) return undefined;
  publishAgentEvent({
    type: "team.brief",
    sessionId:
      getTeamRunSessionId(input.teamRunId) ?? getCurrentSession().sessionId,
    turnId: input.teamRunId,
    seq: 1,
    timestamp: Date.now(),
    teamRunId: input.teamRunId,
    from: brief.from,
    to: brief.to,
    briefType: brief.type,
    content: brief.content,
  });
  return brief;
}
