/* eslint-disable max-lines */
import { Box, Text, useInput, type Key } from "ink";
import React, { useEffect, useState } from "react";

import { t } from "../../i18n/index.js";
import type { QuizItemAnswer } from "../../services/QuizService.js";
import { defaultBoxStyles } from "../styles.js";
import { symbols } from "../symbols.js";
import { theme } from "../theme/tokens.js";
import { sanitizeTerminalText } from "../utils/terminalTextSafety.js";

/**
 * A question as the UI understands it. It mirrors the QuizService question
 * shape so a surface can render a question set without importing the service.
 */
export interface QuizPromptQuestion {
  question: string;
  options?: string[];
  defaultAnswer?: string;
  /** Space toggles options and Enter submits the marked set. */
  multiSelect?: boolean;
  /** The answer is typed directly; options are not shown. */
  freeText?: boolean;
  /** Short tab label; defaults to Q1, Q2, ... */
  header?: string;
}

interface QuizPromptProps {
  question?: string;
  options?: string[];
  defaultAnswer?: string;
  /** A question set. When omitted the single-question props are used. */
  questions?: QuizPromptQuestion[];
  requestId: string;
  onAnswer: (
    requestId: string,
    answer: string,
    isCustomAnswer: boolean,
    answers?: QuizItemAnswer[],
  ) => void;
  /** Called instead of onAnswer when Esc cancels the whole set. */
  onCancel?: (requestId: string) => void;
}

interface QuestionState {
  /** Row under the cursor; the last row is always the Other sentinel. */
  cursor: number;
  /** One flag per option plus a final flag for Other. */
  checked: boolean[];
  otherText: string;
  editingOther: boolean;
  answer: string | null;
  answerIsCustom: boolean;
  /** Labels chosen for a multi-select answer, before comma folding. */
  selected: string[];
  showRequired: boolean;
}

function isFreeText(question: QuizPromptQuestion): boolean {
  return question.freeText === true || !question.options?.length;
}

function initialState(question: QuizPromptQuestion): QuestionState {
  const options = question.options ?? [];
  const freeText = isFreeText(question);
  return {
    cursor: 0,
    checked: [...options.map(() => false), false],
    otherText: "",
    editingOther: freeText,
    answer: null,
    answerIsCustom: false,
    selected: [],
    showRequired: false,
  };
}

function normalizeQuestions(props: QuizPromptProps): QuizPromptQuestion[] {
  if (props.questions && props.questions.length > 0) {
    return props.questions;
  }
  return [
    {
      question: props.question ?? "",
      options: props.options,
      defaultAnswer: props.defaultAnswer,
    },
  ];
}

/**
 * The service carries one string, so a multi-question set is folded into one
 * readable block only when there is more than one question. A single question
 * keeps the exact answer string the engine has always received.
 */
function formatAnswer(
  questions: QuizPromptQuestion[],
  states: QuestionState[],
): string {
  if (questions.length === 1) {
    return states[0]?.answer ?? "";
  }
  return questions
    .map((question, index) => {
      const answer = states[index]?.answer ?? "";
      return `Q: ${question.question}\nA: ${answer}`;
    })
    .join("\n\n");
}

/** The per-question answer the service keeps beside the folded string. */
function answersFor(
  questions: QuizPromptQuestion[],
  states: QuestionState[],
): QuizItemAnswer[] {
  return questions.map((question, index) => {
    const state = states[index];
    return {
      question: question.question,
      answer: state?.answer ?? "",
      isCustomAnswer: state?.answerIsCustom ?? false,
      ...(state?.selected.length ? { selected: [...state.selected] } : {}),
    };
  });
}

function nextUnanswered(states: QuestionState[], from: number): number {
  for (let offset = 1; offset <= states.length; offset += 1) {
    const index = (from + offset) % states.length;
    if (states[index].answer === null) {
      return index;
    }
  }
  return from;
}

function toggleAt(checked: boolean[], index: number): boolean[] {
  const next = [...checked];
  next[index] = !next[index];
  return next;
}

function setAt(checked: boolean[], index: number, value: boolean): boolean[] {
  const next = [...checked];
  next[index] = value;
  return next;
}

/**Quiz prompt component for answering for the AskQuestion tool and QuizService */
export const QuizPrompt: React.FC<QuizPromptProps> = (props) => {
  const { requestId, onAnswer, onCancel } = props;
  const questions = normalizeQuestions(props);
  const questionsKey = questions.map((item) => JSON.stringify(item)).join("|");

  const [states, setStates] = useState<QuestionState[]>(() =>
    questions.map(initialState),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setStates(questions.map(initialState));
    setActiveIndex(0);
    setSubmitted(false);
    // questionsKey is the stable identity of the normalized question set.
  }, [requestId, questionsKey]);

  const activeQuestion = questions[activeIndex];
  const activeState = states[activeIndex] ?? initialState(activeQuestion);
  const options = activeQuestion.options ?? [];
  const otherIndex = options.length;
  const multi =
    activeQuestion.multiSelect === true && !isFreeText(activeQuestion);
  const freeText = isFreeText(activeQuestion);

  const updateActive = (updater: (state: QuestionState) => QuestionState) => {
    setStates((prev) =>
      prev.map((state, index) =>
        index === activeIndex ? updater(state) : state,
      ),
    );
  };

  const finish = (nextStates: QuestionState[]) => {
    setStates(nextStates);
    setSubmitted(true);
    onAnswer(
      requestId,
      formatAnswer(questions, nextStates),
      nextStates.some((state) => state.answerIsCustom),
      answersFor(questions, nextStates),
    );
  };

  const commit = (
    answer: string,
    isCustom: boolean,
    selected: string[] = [],
  ) => {
    const nextStates = states.map((state, index) =>
      index === activeIndex
        ? {
            ...state,
            answer,
            answerIsCustom: isCustom,
            selected,
            editingOther: false,
            showRequired: false,
          }
        : state,
    );
    if (nextStates.every((state) => state.answer !== null)) {
      finish(nextStates);
      return;
    }
    setStates(nextStates);
    setActiveIndex(nextUnanswered(nextStates, activeIndex));
  };

  const moveQuestion = (delta: number) => {
    setActiveIndex(
      (prev) => (prev + delta + questions.length) % questions.length,
    );
  };

  const moveCursor = (delta: number) => {
    const rows = options.length + 1;
    updateActive((state) => ({
      ...state,
      cursor: (state.cursor + delta + rows) % rows,
    }));
  };

  const appendOtherText = (input: string) => {
    updateActive((state) => ({
      ...state,
      editingOther: true,
      otherText: state.otherText + input,
    }));
  };

  const deleteOtherText = () => {
    updateActive((state) => ({
      ...state,
      otherText: state.otherText.slice(0, -1),
    }));
  };

  const selectedLabels = (state: QuestionState): string[] => {
    const labels = options.filter((_, index) => state.checked[index]);
    const other = state.otherText.trim();
    if (state.checked[otherIndex] && other) {
      labels.push(other);
    }
    return labels;
  };

  const submitSelection = () => {
    const labels = selectedLabels(activeState);
    if (labels.length === 0) {
      updateActive((state) => ({ ...state, showRequired: true }));
      return;
    }
    const usesOther =
      activeState.checked[otherIndex] && activeState.otherText.trim() !== "";
    commit(labels.join(", "), usesOther, labels);
  };

  const commitOther = () => {
    const text =
      activeState.otherText.trim() || activeQuestion.defaultAnswer || "";
    if (!text) {
      updateActive((state) => ({
        ...state,
        editingOther: false,
        checked: setAt(state.checked, otherIndex, false),
        showRequired: true,
      }));
      return;
    }
    if (multi) {
      updateActive((state) => ({
        ...state,
        otherText: text,
        editingOther: false,
        checked: setAt(state.checked, otherIndex, true),
      }));
      return;
    }
    commit(text, true);
  };

  const toggleAtCursor = () => {
    if (activeState.cursor === otherIndex) {
      updateActive((state) => {
        const turningOn = !state.checked[otherIndex];
        return {
          ...state,
          checked: toggleAt(state.checked, otherIndex),
          editingOther: turningOn,
          showRequired: false,
        };
      });
      return;
    }
    updateActive((state) => ({
      ...state,
      checked: toggleAt(state.checked, state.cursor),
      showRequired: false,
    }));
  };

  const submit = () => {
    if (activeState.editingOther && activeState.cursor === otherIndex) {
      commitOther();
      return;
    }
    if (activeState.cursor === otherIndex) {
      if (multi) {
        submitSelection();
      } else {
        updateActive((state) => ({ ...state, editingOther: true }));
      }
      return;
    }
    if (multi) {
      submitSelection();
      return;
    }
    commit(
      options[activeState.cursor],
      false,
      multi ? [options[activeState.cursor]] : [],
    );
  };

  const handleOtherEdit = (input: string, key: Key) => {
    if (key.return) {
      commitOther();
      return;
    }
    if (key.backspace || key.delete) {
      deleteOtherText();
      return;
    }
    if (key.upArrow) {
      moveCursor(-1);
      return;
    }
    if (key.downArrow) {
      moveCursor(1);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      appendOtherText(input);
    }
  };

  const handleFreeText = (input: string, key: Key) => {
    if (key.return) {
      const text =
        activeState.otherText.trim() || activeQuestion.defaultAnswer || "";
      if (text) {
        commit(text, true);
      }
      return;
    }
    if (key.backspace || key.delete) {
      deleteOtherText();
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      appendOtherText(input);
    }
  };

  const handleQuestionInput = (input: string, key: Key) => {
    if (freeText) {
      handleFreeText(input, key);
      return;
    }
    if (activeState.editingOther && activeState.cursor === otherIndex) {
      handleOtherEdit(input, key);
      return;
    }
    if (key.upArrow) {
      moveCursor(-1);
      return;
    }
    if (key.downArrow) {
      moveCursor(1);
      return;
    }
    if (key.return) {
      submit();
      return;
    }
    if (multi && input === " ") {
      toggleAtCursor();
      return;
    }
    // Typing only starts a custom answer on the Other row. Letters pressed
    // while a normal option is highlighted must not replace that option.
    if (input && !key.ctrl && !key.meta && activeState.cursor === otherIndex) {
      updateActive((state) => ({
        ...state,
        editingOther: true,
        otherText: state.otherText + input,
        checked: multi ? setAt(state.checked, otherIndex, true) : state.checked,
        showRequired: false,
      }));
    }
  };

  useInput((input, key) => {
    if (submitted) return;
    if (key.escape || (key.ctrl && input === "c")) {
      setSubmitted(true);
      if (onCancel) {
        onCancel(requestId);
      } else {
        onAnswer(
          requestId,
          t("quiz.cancelled"),
          true,
          questions.map((question) => ({
            question: question.question,
            answer: t("quiz.cancelled"),
            isCustomAnswer: true,
          })),
        );
      }
      return;
    }
    if (key.tab) {
      moveQuestion(key.shift ? -1 : 1);
      return;
    }
    if (key.leftArrow) {
      moveQuestion(-1);
      return;
    }
    if (key.rightArrow) {
      moveQuestion(1);
      return;
    }
    handleQuestionInput(input, key);
  });

  if (submitted) {
    return null;
  }

  const hint = multi
    ? t("quiz.hintMulti")
    : freeText
      ? t("quiz.typeAnswer")
      : t("quiz.hint");

  const otherHasText =
    activeState.checked[otherIndex] && activeState.otherText.trim() !== "";

  return (
    <Box
      {...defaultBoxStyles(theme.accent)}
      marginBottom={1}
      flexDirection="column"
    >
      <Box marginBottom={1}>
        {questions.map((item, index) => {
          const answered = states[index]?.answer !== null;
          const active = index === activeIndex;
          const label = item.header ?? `Q${index + 1}`;
          return (
            <Box key={index} marginRight={1}>
              <Text
                color={active ? theme.accent : theme.text.secondary}
                bold={active}
                dimColor={!active && !answered}
              >
                {answered ? symbols().check : symbols().ring}{" "}
                {sanitizeTerminalText(label)}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginBottom={1}>
        <Text color={theme.accent} bold>
          ?{" "}
        </Text>
        <Text bold>{sanitizeTerminalText(activeQuestion.question)}</Text>
      </Box>

      {freeText ? (
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text color={theme.accent}>{symbols().selected} </Text>
            <Text>{sanitizeTerminalText(activeState.otherText)}</Text>
            <Text color="gray">▊</Text>
          </Box>
          {activeQuestion.defaultAnswer && !activeState.otherText && (
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                (Press Enter for default: {activeQuestion.defaultAnswer})
              </Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2}>
          {options.map((option, index) => {
            const focused = index === activeState.cursor;
            const marked = activeState.checked[index];
            return (
              <Box key={index}>
                <Text color={focused ? theme.accent : theme.text.primary}>
                  {focused ? `${symbols().selected} ` : "  "}
                </Text>
                {multi && (
                  <Text color={marked ? theme.accent : theme.text.secondary}>
                    {marked ? `[${symbols().check}] ` : "[ ] "}
                  </Text>
                )}
                <Text
                  color={
                    focused || (multi && marked)
                      ? theme.accent
                      : theme.text.primary
                  }
                  bold={focused}
                >
                  {sanitizeTerminalText(option)}
                </Text>
              </Box>
            );
          })}

          <Box>
            <Text
              color={
                activeState.cursor === otherIndex
                  ? theme.accent
                  : theme.text.primary
              }
              bold={activeState.cursor === otherIndex}
            >
              {activeState.cursor === otherIndex
                ? `${symbols().selected} `
                : "  "}
            </Text>
            {multi && (
              <Text color={otherHasText ? theme.accent : theme.text.secondary}>
                {otherHasText ? `[${symbols().check}] ` : "[ ] "}
              </Text>
            )}
            <Text
              color={
                activeState.cursor === otherIndex
                  ? theme.accent
                  : theme.text.primary
              }
              bold={activeState.cursor === otherIndex}
            >
              {t("quiz.other")}
            </Text>
            {activeState.editingOther ? (
              <>
                <Text>: </Text>
                <Text>{sanitizeTerminalText(activeState.otherText)}</Text>
                {activeState.cursor === otherIndex && (
                  <Text color="gray">▊</Text>
                )}
              </>
            ) : (
              <Text color="gray" dimColor>
                {" "}
                ({t("quiz.otherHint")})
              </Text>
            )}
          </Box>

          {activeState.showRequired && (
            <Box marginTop={1}>
              <Text color={theme.status.error}>
                {t("quiz.selectAtLeastOne")}
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {hint}
        </Text>
      </Box>
    </Box>
  );
};
