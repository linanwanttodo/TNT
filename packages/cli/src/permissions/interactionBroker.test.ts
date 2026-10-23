import { describe, expect, it, vi } from "vitest";

const { approveRequest, rejectRequest, answerQuestion } = vi.hoisted(() => ({
  approveRequest: vi.fn(() => true),
  rejectRequest: vi.fn(() => true),
  answerQuestion: vi.fn(() => true),
}));

vi.mock("./permissionManager.js", () => ({
  toolPermissionManager: { approveRequest, rejectRequest },
}));

vi.mock("../services/QuizService.js", () => ({
  quizService: { answerQuestion },
}));

import {
  createNonInteractiveBroker,
  interactionBroker,
} from "./interactionBroker.js";

describe("interaction broker", () => {
  it("forwards both approvals and questions to their owners", () => {
    expect(interactionBroker.approve("req-1", true)).toBe(true);
    expect(approveRequest).toHaveBeenCalledWith("req-1", true);

    expect(interactionBroker.reject("req-2")).toBe(true);
    expect(rejectRequest).toHaveBeenCalledWith("req-2");

    expect(interactionBroker.answerQuestion("q-1", "yes", true)).toBe(true);
    expect(answerQuestion).toHaveBeenCalledWith("q-1", "yes", true);
  });

  it("never invents consent when there is nobody to ask", () => {
    const broker = createNonInteractiveBroker();

    expect(broker.approve("req")).toBe(false);
    expect(broker.reject("req")).toBe(false);
    expect(broker.answerQuestion("q", "answer")).toBe(false);
  });
});
