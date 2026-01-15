import { quizService } from "../services/QuizService.js";

import { toolPermissionManager } from "./permissionManager.js";

/**
 * One way for a surface to answer the engine's two interactive requests:
 * a tool approval and a question. The TUI and a non-interactive surface differ
 * in the broker they install, not in how a response travels back.
 */
export interface InteractionBroker {
  approve(requestId: string, remember?: boolean): boolean;
  reject(requestId: string): boolean;
  answerQuestion(
    requestId: string,
    answer: string,
    isCustomAnswer?: boolean,
  ): boolean;
}

export const interactionBroker: InteractionBroker = {
  approve: (requestId, remember = false) =>
    toolPermissionManager.approveRequest(requestId, remember),
  reject: (requestId) => toolPermissionManager.rejectRequest(requestId),
  answerQuestion: (requestId, answer, isCustomAnswer = false) =>
    quizService.answerQuestion(requestId, answer, isCustomAnswer),
};

/**
 * A print or daemon surface has nobody to ask. It refuses instead of inventing
 * consent; the engine reports the refusal as a cancelled tool.
 */
export function createNonInteractiveBroker(): InteractionBroker {
  return {
    approve: () => false,
    reject: () => false,
    answerQuestion: () => false,
  };
}
