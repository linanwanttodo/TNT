/**
 * Upper bound on how many model/tool rounds a single user request may run
 * before the loop stops itself. Without it a model that keeps emitting tool
 * calls streams forever, burning tokens with no way for the user to notice
 * until the bill arrives.
 */
export const MAX_AGENT_TURNS = 50;

export function isAgentTurnLimitReached(depth: number): boolean {
  return depth >= MAX_AGENT_TURNS;
}
