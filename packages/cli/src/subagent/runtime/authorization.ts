export interface SubagentSessionIdentity {
  parentSessionId?: string;
  subagentType?: string;
}

export function canControlSubagentSession(
  target: SubagentSessionIdentity | null | undefined,
  parentSessionId: string,
  requesterSessionId?: string,
  requester?: SubagentSessionIdentity | null,
): target is SubagentSessionIdentity & { parentSessionId: string } {
  if (!target?.subagentType || !target.parentSessionId) return false;
  if (target.parentSessionId === parentSessionId) return true;
  return Boolean(
    requesterSessionId &&
    requester?.subagentType &&
    requester.parentSessionId === target.parentSessionId,
  );
}
