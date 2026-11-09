import type {
  ZCodePermissionRequestParams,
  ZCodeUserInputQuestion,
  ZCodeUserInputRequestParams,
} from "@zcode/shared";

import { t } from "../i18n/index.js";
import type { ToolCallRequest } from "../permissions/types.js";
import type { QuizItemAnswer, QuizQuestion } from "../services/QuizService.js";

export interface PendingPermission {
  requestId: string;
  toolCall: ToolCallRequest;
  sessionId: string | null;
  turnId: string | null;
  toolCallId: string | null;
  outgoing: string | null;
}

export interface PendingQuestion {
  requestId: string;
  questions: QuizQuestion[];
  sessionId: string | null;
  turnId: string | null;
  outgoing: string | null;
}

/** The one option a free-text question needs for the ZCode question schema. */
export const FREE_TEXT_OPTION_VALUE = "__tnt_free_text__";

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function permissionReason(toolCall: ToolCallRequest): string {
  const preview = toolCall.preview?.find((entry) => entry.type === "text");
  const reason = preview?.content?.trim();
  return reason && reason.length > 0 ? reason : "Tool requires permission";
}

export function permissionParams(
  pending: PendingPermission,
  sessionId: string,
): ZCodePermissionRequestParams {
  const { toolCall } = pending;
  return {
    requestId: pending.requestId,
    sessionId,
    ...(pending.turnId ? { turnId: pending.turnId } : {}),
    toolCallId: pending.toolCallId ?? toolCall.toolCallId ?? pending.requestId,
    toolName: toolCall.name,
    reason: permissionReason(toolCall),
    riskLevel: "medium",
    input: toolCall.arguments,
    options: [
      {
        optionId: "allow_once",
        kind: "allowOnce",
        name: "Allow once",
        response: { decision: "allow" },
      },
      {
        optionId: "allow_always",
        kind: "allowAlways",
        name: "Allow for this session",
        response: {
          decision: "allow",
          permissionUpdates: [
            {
              type: "addRules",
              behavior: "allow",
              rules: [{ toolName: toolCall.name }],
            },
          ],
        },
      },
      {
        optionId: "deny",
        kind: "deny",
        name: "Deny",
        response: { decision: "deny" },
      },
    ],
  };
}

function usableOptions(question: QuizQuestion): string[] {
  return (question.options ?? []).filter((option) => option.length > 0);
}

function isFreeText(question: QuizQuestion): boolean {
  return question.freeText === true || usableOptions(question).length === 0;
}

function isQuizQuestion(value: unknown): value is QuizQuestion {
  const record = asRecord(value);
  return typeof record.question === "string" && record.question !== "";
}

/** The question set carried by either the new or the legacy request shape. */
export function questionSetFrom(value: unknown): QuizQuestion[] | undefined {
  const record = asRecord(value);
  const questions = Array.isArray(record.questions)
    ? record.questions.filter(isQuizQuestion)
    : [];
  if (questions.length > 0) {
    return questions;
  }
  return isQuizQuestion(record.question) ? [record.question] : undefined;
}

function promptFor(questions: QuizQuestion[]): string {
  if (questions.length === 1) {
    return questions[0]?.question ?? "";
  }
  return questions
    .map(
      (question, index) =>
        `${question.header ?? `Q${index + 1}`}. ${question.question}`,
    )
    .join("\n");
}

/**
 * ZCode's question schema requires at least one option per question. A
 * free-text TNT question is therefore shown with one placeholder option while
 * the UI's own custom-answer input carries the typed value. A lone free-text
 * question keeps the original request shape, where `prompt` alone opens a
 * plain input.
 */
export function zcodeQuestions(
  questions: QuizQuestion[],
): ZCodeUserInputQuestion[] | undefined {
  if (questions.length === 1 && isFreeText(questions[0])) {
    return undefined;
  }
  return questions.map((question, index) => {
    const header = question.header?.trim() || `Q${index + 1}`;
    if (isFreeText(question)) {
      return {
        question: question.question,
        header,
        options: [
          { value: FREE_TEXT_OPTION_VALUE, label: t("quiz.freeTextOption") },
        ],
      };
    }
    return {
      question: question.question,
      header,
      options: usableOptions(question).map((choice) => ({
        value: choice,
        label: choice,
      })),
      ...(question.multiSelect ? { multiSelect: true } : {}),
    };
  });
}

export function userInputParams(
  pending: PendingQuestion,
  sessionId: string,
): ZCodeUserInputRequestParams {
  const questions = zcodeQuestions(pending.questions);
  return {
    requestId: pending.requestId,
    sessionId,
    ...(pending.turnId ? { turnId: pending.turnId } : {}),
    prompt: promptFor(pending.questions),
    ...(questions ? { questions } : {}),
  };
}

export interface QuestionChoice {
  index: number;
  value: string;
}

/**
 * Resolve an `optionId` to the question it belongs to. The historical
 * `option-<n>` form addresses the first question; a plain value is matched
 * against every question's options.
 */
export function choiceForQuestions(
  questions: QuizQuestion[],
  optionId: string,
): QuestionChoice | undefined {
  const match = /^option-(\d+)$/.exec(optionId);
  if (match) {
    const value = usableOptions(questions[0])[Number(match[1])];
    return value === undefined ? undefined : { index: 0, value };
  }
  for (let index = 0; index < questions.length; index += 1) {
    if (usableOptions(questions[index]).includes(optionId)) {
      return { index, value: optionId };
    }
  }
  return undefined;
}

function valuesOf(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  }
  return [];
}

function valuesFor(
  record: Record<string, unknown>,
  byQuestion: Record<string, unknown>,
  question: QuizQuestion,
  index: number,
  count: number,
): string[] {
  const indexed = valuesOf(record[`answer_${index}`]);
  if (indexed.length > 0) {
    return indexed;
  }
  const byText = valuesOf(byQuestion[question.question]);
  if (byText.length > 0) {
    return byText;
  }
  if (count === 1) {
    const legacy = valuesOf(record.answer);
    if (legacy.length > 0) {
      return legacy;
    }
  }
  return [];
}

function itemAnswer(question: QuizQuestion, values: string[]): QuizItemAnswer {
  const options = usableOptions(question);
  const cleaned = values.filter((value) => value !== FREE_TEXT_OPTION_VALUE);
  const selected = cleaned.filter((value) => options.includes(value));
  const custom = cleaned.filter((value) => !options.includes(value));
  return {
    question: question.question,
    answer: cleaned.join(", "),
    isCustomAnswer: custom.length > 0,
    ...(question.multiSelect && selected.length > 0 ? { selected } : {}),
  };
}

/**
 * The ZCode UI writes `answer_<index>` for every question (an array when
 * multi-select), repeats the folded answers by question text, and keeps the
 * legacy `answer` for a single question. Read them in that order.
 */
export function answersFromContent(
  questions: QuizQuestion[],
  content: unknown,
): QuizItemAnswer[] | undefined {
  if (questions.length === 0) {
    return undefined;
  }
  const record = asRecord(content);
  const byQuestion = asRecord(record.answers);
  const answers = questions.map((question, index) =>
    itemAnswer(
      question,
      valuesFor(record, byQuestion, question, index, questions.length),
    ),
  );
  return answers.some(
    (answer) => answer.answer.length > 0 || (answer.selected?.length ?? 0) > 0,
  )
    ? answers
    : undefined;
}

export function answerFromContent(content: unknown): string {
  const record = asRecord(content);
  if (
    typeof record.answer === "string" &&
    record.answer !== FREE_TEXT_OPTION_VALUE
  ) {
    return record.answer;
  }
  const answers = asRecord(record.answers);
  const values = Object.values(answers).filter(
    (value): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      value !== FREE_TEXT_OPTION_VALUE,
  );
  if (values.length === 1) {
    return values[0] ?? "";
  }
  if (values.length > 1) {
    return values.join("\n");
  }
  const indexed = Object.keys(record)
    .filter((key) => key.startsWith("answer_"))
    .sort()
    .find(
      (key) =>
        typeof record[key] === "string" &&
        record[key] !== FREE_TEXT_OPTION_VALUE,
    );
  return indexed ? String(record[indexed]) : "";
}
