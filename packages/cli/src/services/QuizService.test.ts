import { describe, expect, it } from "vitest";

import {
  QuizService,
  type QuestionAnsweredEvent,
  type QuestionRequestedEvent,
} from "./QuizService.js";

describe("QuizService", () => {
  it("keeps the legacy single-question string contract", async () => {
    const service = new QuizService();
    const asked = service.askQuestion({
      question: "Continue?",
      options: ["yes", "no"],
    });

    const pending = service.getState().pendingQuestion;
    expect(pending?.questions).toEqual([
      { question: "Continue?", options: ["yes", "no"] },
    ]);

    expect(service.answerQuestion(pending?.requestId ?? "", "yes")).toBe(true);
    await expect(asked).resolves.toBe("yes");
  });

  it("asks a set and resolves one answer per question", async () => {
    const service = new QuizService();
    const requested: QuestionRequestedEvent[] = [];
    const answered: QuestionAnsweredEvent[] = [];
    service.on("questionRequested", (event) => requested.push(event));
    service.on("questionAnswered", (event) => answered.push(event));

    const asked = service.askQuestions([
      { question: "Which model?", options: ["a", "b"], header: "Model" },
      {
        question: "Which extras?",
        options: ["x", "y"],
        multiSelect: true,
        header: "Extras",
      },
    ]);

    const requestId = service.getState().pendingQuestion?.requestId ?? "";
    expect(requested).toHaveLength(1);
    expect(requested[0]?.requestId).toBe(requestId);
    expect(requested[0]?.question).toBe(requested[0]?.questions[0]);
    expect(requested[0]?.questions).toHaveLength(2);

    const answers = [
      { question: "Which model?", answer: "b", isCustomAnswer: false },
      {
        question: "Which extras?",
        answer: "x, y",
        isCustomAnswer: false,
        selected: ["x", "y"],
      },
    ];
    expect(service.answerQuestion(requestId, "ignored", false, answers)).toBe(
      true,
    );

    const result = await asked;
    expect(result.answers).toEqual(answers);
    expect(result.answer).toBe(
      "Q: Which model?\nA: b\n\nQ: Which extras?\nA: x, y",
    );
    expect(result.isCustomAnswer).toBe(false);
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({
      requestId,
      answer: result.answer,
      answers,
    });

    expect(service.answerQuestion(requestId, "late")).toBe(false);
  });

  it("marks a set custom when any question is", async () => {
    const service = new QuizService();
    const asked = service.askQuestions([
      { question: "First", options: ["a"] },
      { question: "Second", options: ["b"] },
    ]);
    const requestId = service.getState().pendingQuestion?.requestId ?? "";

    service.answerQuestion(requestId, "ignored", false, [
      { question: "First", answer: "a", isCustomAnswer: false },
      { question: "Second", answer: "typed", isCustomAnswer: true },
    ]);

    const result = await asked;
    expect(result.isCustomAnswer).toBe(true);
    expect(result.answer).toBe("Q: First\nA: a\n\nQ: Second\nA: typed");
  });

  it("refuses an empty set", async () => {
    await expect(new QuizService().askQuestions([])).rejects.toThrow(
      "askQuestions needs at least one question",
    );
  });
});
