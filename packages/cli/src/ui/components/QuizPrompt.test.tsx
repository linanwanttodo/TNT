import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../i18n/index.js";
import { symbols } from "../symbols.js";

import { QuizPrompt, type QuizPromptQuestion } from "./QuizPrompt.js";

const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  for (const tree of mounted) tree.unmount();
  mounted.length = 0;
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";
const SHIFT_TAB = "\x1b[Z";
const TAB = "\t";

function renderQuiz(
  overrides: Partial<React.ComponentProps<typeof QuizPrompt>> = {},
) {
  const onAnswer = vi.fn();
  const tree = track(
    <QuizPrompt
      question="Pick one"
      options={["Alpha", "Beta"]}
      requestId="req-1"
      onAnswer={onAnswer}
      {...overrides}
    />,
  );
  return { tree, onAnswer };
}

describe("the quiz prompt", () => {
  it("keeps the single-question answer contract and hint", async () => {
    const { tree, onAnswer } = renderQuiz();
    await settle();

    expect(t("quiz.hint")).toBe(
      "Enter to select · Up/Down to navigate · Tab to switch questions · Esc to cancel",
    );
    expect(tree.lastFrame()).toContain("Enter to select");
    expect(tree.lastFrame()).toContain("Esc to cancel");

    tree.stdin.write(DOWN);
    await settle();
    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", "Beta", false, [
      { question: "Pick one", answer: "Beta", isCustomAnswer: false },
    ]);
  });

  it("does not replace a highlighted option when letters are typed", async () => {
    const { tree, onAnswer } = renderQuiz();
    await settle();

    tree.stdin.write("zzz");
    await settle();
    expect(tree.lastFrame()).not.toContain("zzz");

    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", "Alpha", false, [
      { question: "Pick one", answer: "Alpha", isCustomAnswer: false },
    ]);
  });

  it("switches questions with Tab, Shift+Tab and the arrow keys", async () => {
    const questions: QuizPromptQuestion[] = [
      { question: "First question?", options: ["One", "Two"] },
      { question: "Second question?", options: ["Three", "Four"] },
    ];
    const { tree } = renderQuiz({ question: undefined, questions });
    await settle();

    expect(tree.lastFrame()).toContain("First question?");

    tree.stdin.write(TAB);
    await settle();
    expect(tree.lastFrame()).toContain("Second question?");
    expect(tree.lastFrame()).not.toContain("First question?");

    tree.stdin.write(SHIFT_TAB);
    await settle();
    expect(tree.lastFrame()).toContain("First question?");

    tree.stdin.write("\x1b[C");
    await settle();
    expect(tree.lastFrame()).toContain("Second question?");

    tree.stdin.write("\x1b[D");
    await settle();
    expect(tree.lastFrame()).toContain("First question?");
  });

  it("marks answered tabs and folds the set into one answer", async () => {
    const questions: QuizPromptQuestion[] = [
      { question: "First question?", options: ["A1", "A2"] },
      { question: "Second question?", options: ["B1"] },
    ];
    const { tree, onAnswer } = renderQuiz({ question: undefined, questions });
    await settle();

    expect(tree.lastFrame()).toContain(`${symbols().ring} Q1`);
    expect(tree.lastFrame()).toContain(`${symbols().ring} Q2`);

    tree.stdin.write(ENTER);
    await settle();
    expect(tree.lastFrame()).toContain(`${symbols().check} Q1`);
    expect(tree.lastFrame()).toContain("Second question?");

    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith(
      "req-1",
      "Q: First question?\nA: A1\n\nQ: Second question?\nA: B1",
      false,
      [
        { question: "First question?", answer: "A1", isCustomAnswer: false },
        { question: "Second question?", answer: "B1", isCustomAnswer: false },
      ],
    );
  });

  it("toggles a multi-select set with Space and submits it with Enter", async () => {
    const onAnswer = vi.fn();
    const multi = track(
      <QuizPrompt
        question="Pick many"
        requestId="req-1"
        onAnswer={onAnswer}
        questions={[
          {
            question: "Pick many",
            options: ["One", "Two", "Three"],
            multiSelect: true,
          },
        ]}
      />,
    );
    await settle();

    expect(t("quiz.hintMulti")).toBe(
      "Space to toggle · Enter to submit · Up/Down to navigate · Tab to switch questions · Esc to cancel",
    );
    expect(multi.lastFrame()).toContain("Space to toggle");
    expect(multi.lastFrame()).toContain("Enter to submit");

    multi.stdin.write(" ");
    await settle();
    expect(multi.lastFrame()).toContain(`[${symbols().check}] One`);

    multi.stdin.write(DOWN);
    await settle();
    multi.stdin.write(" ");
    await settle();

    multi.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", "One, Two", false, [
      {
        question: "Pick many",
        answer: "One, Two",
        isCustomAnswer: false,
        selected: ["One", "Two"],
      },
    ]);
  });

  it("renders headers and folds a per-question multi-select set", async () => {
    const onAnswer = vi.fn();
    const tree = track(
      <QuizPrompt
        requestId="req-1"
        onAnswer={onAnswer}
        questions={[
          { question: "First?", options: ["A1", "A2"], header: "Scope" },
          {
            question: "Second?",
            options: ["B1", "B2"],
            multiSelect: true,
            header: "Extras",
          },
        ]}
      />,
    );
    await settle();

    expect(tree.lastFrame()).toContain("Scope");
    expect(tree.lastFrame()).toContain("Extras");

    tree.stdin.write(ENTER);
    await settle();
    expect(tree.lastFrame()).toContain("Second?");

    tree.stdin.write(" ");
    await settle();
    tree.stdin.write(DOWN);
    await settle();
    tree.stdin.write(" ");
    await settle();
    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith(
      "req-1",
      "Q: First?\nA: A1\n\nQ: Second?\nA: B1, B2",
      false,
      [
        { question: "First?", answer: "A1", isCustomAnswer: false },
        {
          question: "Second?",
          answer: "B1, B2",
          isCustomAnswer: false,
          selected: ["B1", "B2"],
        },
      ],
    );
  });

  it("requires at least one marked option before submitting", async () => {
    const onAnswer = vi.fn();
    const tree = track(
      <QuizPrompt
        question="Pick many"
        requestId="req-1"
        onAnswer={onAnswer}
        questions={[
          {
            question: "Pick many",
            options: ["One", "Two"],
            multiSelect: true,
          },
        ]}
      />,
    );
    await settle();

    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).not.toHaveBeenCalled();
    expect(tree.lastFrame()).toContain("Select at least one option");
  });

  it("turns the Other row into free text and submits it as custom", async () => {
    const { tree, onAnswer } = renderQuiz({ options: ["Alpha"] });
    await settle();

    tree.stdin.write(DOWN);
    await settle();
    tree.stdin.write("custom");
    await settle();
    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", "custom", true, [
      { question: "Pick one", answer: "custom", isCustomAnswer: true },
    ]);
  });

  it("adds typed Other text to a multi-select set", async () => {
    const onAnswer = vi.fn();
    const tree = track(
      <QuizPrompt
        question="Pick many"
        requestId="req-1"
        onAnswer={onAnswer}
        questions={[
          {
            question: "Pick many",
            options: ["One", "Two"],
            multiSelect: true,
          },
        ]}
      />,
    );
    await settle();

    tree.stdin.write(DOWN);
    await settle();
    tree.stdin.write(DOWN);
    await settle();
    tree.stdin.write("custom");
    await settle();
    expect(tree.lastFrame()).toContain("custom");

    tree.stdin.write(ENTER);
    await settle();
    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", "custom", true, [
      {
        question: "Pick many",
        answer: "custom",
        isCustomAnswer: true,
        selected: ["custom"],
      },
    ]);
  });

  it("accepts a free-text question without options", async () => {
    const onAnswer = vi.fn();
    const tree = track(
      <QuizPrompt
        question="Describe the change"
        requestId="req-1"
        onAnswer={onAnswer}
      />,
    );
    await settle();

    tree.stdin.write("hello");
    await settle();
    tree.stdin.write(ENTER);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", "hello", true, [
      {
        question: "Describe the change",
        answer: "hello",
        isCustomAnswer: true,
      },
    ]);
  });

  it("cancels with a clear answer on Escape", async () => {
    const { tree, onAnswer } = renderQuiz();
    await settle();

    tree.stdin.write(ESC);
    await settle();

    expect(onAnswer).toHaveBeenCalledWith("req-1", t("quiz.cancelled"), true, [
      {
        question: "Pick one",
        answer: t("quiz.cancelled"),
        isCustomAnswer: true,
      },
    ]);
  });

  it("gives a cancel handler the request instead of an answer", async () => {
    const onAnswer = vi.fn();
    const onCancel = vi.fn();
    const tree = track(
      <QuizPrompt
        question="Pick one"
        options={["Alpha"]}
        requestId="req-1"
        onAnswer={onAnswer}
        onCancel={onCancel}
      />,
    );
    await settle();

    tree.stdin.write(ESC);
    await settle();

    expect(onCancel).toHaveBeenCalledWith("req-1");
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
