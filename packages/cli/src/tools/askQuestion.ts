import { quizService } from "../services/QuizService.js";
import type { QuizItemAnswer, QuizQuestion } from "../services/QuizService.js";

import { Tool } from "./types.js";

const MAX_QUESTIONS = 8;

interface AskQuestionArgs {
  question?: unknown;
  options?: unknown;
  defaultAnswer?: unknown;
  questions?: unknown;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringOptions(value: unknown, path: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of strings`);
  }
  return value.map((option, index) => {
    if (typeof option !== "string" || option.length === 0) {
      throw new Error(`${path}[${index}] must be a non-empty string`);
    }
    return option;
  });
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
  return value;
}

function normalizeQuestion(value: unknown, path: string): QuizQuestion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const options =
    record.options === undefined
      ? undefined
      : stringOptions(record.options, `${path}.options`);
  return {
    question: requiredString(record.question, `${path}.question`),
    ...(options === undefined ? {} : { options }),
    ...(record.defaultAnswer === undefined
      ? {}
      : {
          defaultAnswer: optionalString(
            record.defaultAnswer,
            `${path}.defaultAnswer`,
          ),
        }),
    ...(record.multiSelect === undefined
      ? {}
      : {
          multiSelect: optionalBoolean(
            record.multiSelect,
            `${path}.multiSelect`,
          ),
        }),
    ...(record.freeText === undefined
      ? {}
      : { freeText: optionalBoolean(record.freeText, `${path}.freeText`) }),
    ...(record.header === undefined
      ? {}
      : { header: optionalString(record.header, `${path}.header`) }),
  };
}

/**
 * A call is either the legacy `question`/`options` pair or a `questions` set.
 * The set form is preferred when both arrive, because a model that learned the
 * newer shape sometimes leaves the old fields behind.
 */
function questionSet(args: AskQuestionArgs): QuizQuestion[] {
  if (args.questions !== undefined) {
    if (!Array.isArray(args.questions) || args.questions.length === 0) {
      throw new Error("questions must be a non-empty array");
    }
    if (args.questions.length > MAX_QUESTIONS) {
      throw new Error(`AskQuestion accepts at most ${MAX_QUESTIONS} questions`);
    }
    return args.questions.map((question, index) =>
      normalizeQuestion(question, `questions[${index}]`),
    );
  }

  const question = requiredString(args.question, "question");
  const options =
    args.options === undefined
      ? undefined
      : stringOptions(args.options, "options");
  const defaultAnswer = optionalString(args.defaultAnswer, "defaultAnswer");
  return [
    {
      question,
      ...(options === undefined ? {} : { options }),
      ...(defaultAnswer === undefined ? {} : { defaultAnswer }),
    },
  ];
}

function describeSingle(
  question: QuizQuestion,
  answer: QuizItemAnswer,
): string {
  const options = question.options ?? [];
  if (options.length > 0) {
    if (answer.selected && answer.selected.length > 1) {
      return `User selected options: ${answer.selected
        .map((option) => `"${option}"`)
        .join(", ")}`;
    }
    const selectedIndex = options.indexOf(answer.answer);
    if (selectedIndex !== -1) {
      return `User selected option ${selectedIndex + 1}: "${answer.answer}"`;
    }
    return `User provided custom answer: "${answer.answer}"`;
  }
  return `User answered: "${answer.answer}"`;
}

export const askQuestionTool: Tool = {
  name: "AskQuestion",
  displayName: "Ask Question",
  description: `Ask the user a clarifying question to gather requirements, preferences, or implementation details before proceeding.
Guidelines:
- You should use this tool **whenever you want to clarify your assumption or need answers to build your plan**.
- DO NOT supply "other" or "none of the above" or similar as an option. User can always provide a free-form answer when needed.
`,
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question to ask in the legacy single-question form. Omit when using questions.",
      },
      options: {
        type: "array",
        description:
          "The list of choices for the legacy single question. Leave as empty array if the user should provide a free-form answer.",
        items: {
          type: "string",
        },
      },
      defaultAnswer: {
        type: "string",
        description:
          "Default answer if user presses Enter without providing input",
      },
      questions: {
        type: "array",
        maxItems: MAX_QUESTIONS,
        description:
          "Ask up to 8 questions in one prompt. Use this instead of question/options to collect answers together.",
        items: {
          type: "object",
          required: ["question"],
          properties: {
            question: {
              type: "string",
              description: "The question to ask",
            },
            options: {
              type: "array",
              description:
                "The list of choices. Leave empty or omit when the answer is typed free-form.",
              items: {
                type: "string",
              },
            },
            defaultAnswer: {
              type: "string",
              description: "Default answer for an empty free-form submission",
            },
            multiSelect: {
              type: "boolean",
              description: "Allow selecting more than one option",
            },
            freeText: {
              type: "boolean",
              description: "Ask for a typed answer instead of choices",
            },
            header: {
              type: "string",
              description: "Short tab label; defaults to Q1, Q2, ...",
            },
          },
        },
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async (args: AskQuestionArgs): Promise<string> => {
    const questions = questionSet(args);
    const result = await quizService.askQuestions(questions);

    if (questions.length === 1) {
      const answer = result.answers[0];
      return describeSingle(
        questions[0],
        answer ?? {
          question: questions[0].question,
          answer: result.answer,
          isCustomAnswer: result.isCustomAnswer,
        },
      );
    }

    return `User answered:\n${result.answer}`;
  },
};
