/**
 * The engine's input vocabulary. A surface submits one of these; the session
 * controller turns it into a run, an interrupt, or an answer to a pending
 * interaction.
 */

export interface AgentCommandBase {
  /** Stable per submission, so a retried transport cannot run it twice. */
  commandId: string;
  sessionId: string;
  timestamp: number;
}

export type AgentCommand = AgentCommandBase &
  (
    | {
        type: "prompt.submit";
        prompt: string;
        /** Base64 image payloads keyed by their placeholder index. */
        images?: ReadonlyMap<string, string>;
        maxSteps?: number;
      }
    | { type: "turn.interrupt"; reason?: string }
    | {
        type: "permission.respond";
        requestId: string;
        approved: boolean;
        remember?: boolean;
      }
    | {
        type: "question.respond";
        requestId: string;
        answer: string;
        isCustomAnswer?: boolean;
      }
    | { type: "session.load"; sessionId: string }
    | { type: "session.fork"; sessionId: string; fromTurnId?: string }
  );

export type AgentCommandType = AgentCommand["type"];

export function createCommandId(now: () => number = Date.now): string {
  return `cmd-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A command without the envelope fields, which the controller fills in. */
type DistributiveOmit<T, K extends keyof any> = T extends any
  ? Omit<T, K>
  : never;

export type AgentCommandInput = DistributiveOmit<
  AgentCommand,
  keyof AgentCommandBase
>;
