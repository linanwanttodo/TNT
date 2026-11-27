import { loadSessionById } from "../../session/index.js";

import { canControlSubagentSession } from "./authorization.js";
import { findSubagentRunBySessionId } from "./spawner.js";

export function readSubagentTranscript(
  sessionId: string,
  parentSessionId: string,
): {
  sessionId: string;
  messages: unknown[];
  status: string;
} | null {
  const session = loadSessionById(sessionId);
  if (!session || !canControlSubagentSession(session, parentSessionId)) {
    return null;
  }
  return {
    sessionId,
    messages: [
      ...session.history,
      ...(session.pendingSubagentMessages ?? []).map((content) => ({
        message: { role: "user" as const, content },
        contextItems: [],
      })),
    ],
    status: findSubagentRunBySessionId(sessionId)?.status ?? "persisted",
  };
}
