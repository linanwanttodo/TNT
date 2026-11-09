import { afterEach, describe, expect, it, vi } from "vitest";

import { quizService, type QuizAnswer } from "../services/QuizService.js";

import { askQuestionTool } from "./askQuestion.js";

function answer(overrides: Partial<QuizAnswer> = {}): QuizAnswer {
  return {
    requestId: "quiz-1",
    answer: "Alpha",
    isCustomAnswer: false,
    answers: [{ question: "Pick", answer: "Alpha", isCustomAnswer: false }],
    ...overrides,
  };
}

describe("the AskQuestion tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts the legacy single question and keeps its result wording", async () => {
    const ask = vi.spyOn(quizService, "askQuestions").mockResolvedValue(
      answer({
        answer: "Beta",
        answers: [{ question: "Pick", answer: "Beta", isCustomAnswer: false }],
      }),
    );

    await expect(
      askQuestionTool.run({ question: "Pick", options: ["Alpha", "Beta"] }),
    ).resolves.toBe('User selected option 2: "Beta"');
    expect(ask).toHaveBeenCalledWith([
      { question: "Pick", options: ["Alpha", "Beta"] },
    ]);
  });

  it("accepts a validated question set with multi-select and free text", async () => {
    const ask = vi.spyOn(quizService, "askQuestions").mockResolvedValue({
      requestId: "quiz-1",
      answer: "Q: First\nA: b\n\nQ: Second\nA: typed",
      isCustomAnswer: true,
      answers: [
        { question: "First", answer: "b", isCustomAnswer: false },
        { question: "Second", answer: "typed", isCustomAnswer: true },
      ],
    });

    await expect(
      askQuestionTool.run({
        questions: [
          { question: "First", options: ["a", "b"], header: "One" },
          { question: "Second", freeText: true, header: "Two" },
        ],
      }),
    ).resolves.toBe("User answered:\nQ: First\nA: b\n\nQ: Second\nA: typed");

    expect(ask).toHaveBeenCalledWith([
      { question: "First", options: ["a", "b"], header: "One" },
      { question: "Second", freeText: true, header: "Two" },
    ]);
  });

  it("names the selected labels of a multi-select question", async () => {
    vi.spyOn(quizService, "askQuestions").mockResolvedValue(
      answer({
        answer: "a, c",
        answers: [
          {
            question: "Pick many",
            answer: "a, c",
            isCustomAnswer: false,
            selected: ["a", "c"],
          },
        ],
      }),
    );

    await expect(
      askQuestionTool.run({
        questions: [
          {
            question: "Pick many",
            options: ["a", "b", "c"],
            multiSelect: true,
          },
        ],
      }),
    ).resolves.toBe('User selected options: "a", "c"');
  });

  it("refuses an empty question set", async () => {
    await expect(askQuestionTool.run({ questions: [] })).rejects.toThrow(
      "questions must be a non-empty array",
    );
  });

  it("caps a question set at eight", async () => {
    const questions = Array.from({ length: 9 }, (_, index) => ({
      question: `Question ${index + 1}`,
    }));

    await expect(askQuestionTool.run({ questions })).rejects.toThrow(
      "AskQuestion accepts at most 8 questions",
    );
  });

  it("refuses a call with neither form", async () => {
    await expect(askQuestionTool.run({})).rejects.toThrow(
      "question must be a non-empty string",
    );
  });

  it("names the bad field inside a question", async () => {
    await expect(
      askQuestionTool.run({ questions: [{ options: ["a"] }] }),
    ).rejects.toThrow("questions[0].question must be a non-empty string");
    await expect(
      askQuestionTool.run({
        questions: [{ question: "Pick", options: ["a", 2] }],
      }),
    ).rejects.toThrow("questions[0].options[1] must be a non-empty string");
  });
});
