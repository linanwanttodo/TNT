import { EventEmitter } from "events";

/**Types */
export interface QuizQuestion {
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

/** One question's part of an answer, in request order. */
export interface QuizItemAnswer {
  question: string;
  answer: string;
  isCustomAnswer: boolean;
  /** The chosen option labels of a multi-select question. */
  selected?: string[];
}

export interface PendingQuestion {
  requestId: string;
  /** The ordered set. A legacy single-question ask is a one-element set. */
  questions: QuizQuestion[];
  timestamp: number;
}

export interface QuizAnswer {
  requestId: string;
  /** One question is plain; several become Q/A blocks. */
  answer: string;
  isCustomAnswer: boolean;
  /** One entry per question, in request order. */
  answers: QuizItemAnswer[];
}

export interface QuizServiceState {
  pendingQuestion: PendingQuestion | null;
}

export interface QuestionRequestedEvent {
  requestId: string;
  /** The first question, for callers of the single-question contract. */
  question: QuizQuestion;
  questions: QuizQuestion[];
}

export interface QuestionAnsweredEvent {
  requestId: string;
  answer: string;
  isCustomAnswer: boolean;
  answers: QuizItemAnswer[];
}

/**
 * The string contract every caller has always consumed: a single question
 * keeps its plain answer, a set is folded into Q/A blocks, and a multi-select
 * answer is the comma-joined labels.
 */
export function formatQuizAnswer(
  questions: QuizQuestion[],
  answers: QuizItemAnswer[],
): string {
  if (questions.length === 1) {
    return answers[0]?.answer ?? "";
  }
  return questions
    .map((question, index) => {
      const answer = answers[index]?.answer ?? "";
      return `Q: ${question.question}\nA: ${answer}`;
    })
    .join("\n\n");
}

/**Quiz service */
export class QuizService extends EventEmitter {
  private pendingRequests = new Map<
    string,
    {
      questions: QuizQuestion[];
      resolve: (answer: QuizAnswer) => void;
    }
  >();

  private currentState: QuizServiceState = {
    pendingQuestion: null,
  };

  /**set a pending question to be answered and return the plain answer string */
  async askQuestion(question: QuizQuestion): Promise<string> {
    const answer = await this.askQuestions([question]);
    return answer.answer;
  }

  /**set a pending question set and resolve with every question's answer */
  async askQuestions(questions: QuizQuestion[]): Promise<QuizAnswer> {
    if (questions.length === 0) {
      throw new Error("askQuestions needs at least one question");
    }
    const requestId = `quiz-${Date.now()}`;

    return new Promise<QuizAnswer>((resolve) => {
      const pendingQuestion: PendingQuestion = {
        requestId,
        questions: [...questions],
        timestamp: Date.now(),
      };

      this.pendingRequests.set(requestId, {
        questions: pendingQuestion.questions,
        resolve,
      });

      this.currentState.pendingQuestion = pendingQuestion;

      const event: QuestionRequestedEvent = {
        requestId,
        question: pendingQuestion.questions[0],
        questions: pendingQuestion.questions,
      };

      this.emit("questionRequested", event);
    });
  }

  /**
   *answer the pending request and resolve the answer. `answers` carries the
   *per-question detail a multi-question surface collects; without it the
   *single `answer` string is assigned to the first question, which keeps the
   *legacy single-question callers exact.
   */
  answerQuestion(
    requestId: string,
    answer: string,
    isCustomAnswer = false,
    answers?: QuizItemAnswer[],
  ): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    this.pendingRequests.delete(requestId);
    this.currentState.pendingQuestion = null;

    const perQuestion = this.normalizeAnswers(
      pending.questions,
      answer,
      isCustomAnswer,
      answers,
    );
    const resolved: QuizAnswer = {
      requestId,
      answer: formatQuizAnswer(pending.questions, perQuestion),
      isCustomAnswer: answers
        ? perQuestion.some((entry) => entry.isCustomAnswer)
        : isCustomAnswer,
      answers: perQuestion,
    };

    const event: QuestionAnsweredEvent = {
      requestId,
      answer: resolved.answer,
      isCustomAnswer: resolved.isCustomAnswer,
      answers: perQuestion,
    };

    this.emit("questionAnswered", event);
    pending.resolve(resolved);

    return true;
  }

  async initialize(): Promise<QuizServiceState> {
    this.currentState = {
      pendingQuestion: null,
    };
    this.pendingRequests.clear();
    return this.currentState;
  }

  getState(): QuizServiceState {
    return this.currentState;
  }

  private normalizeAnswers(
    questions: QuizQuestion[],
    answer: string,
    isCustomAnswer: boolean,
    answers?: QuizItemAnswer[],
  ): QuizItemAnswer[] {
    return questions.map((question, index) => {
      const provided = answers?.[index];
      if (provided) {
        return {
          question: question.question,
          answer: provided.answer,
          isCustomAnswer: provided.isCustomAnswer,
          ...(provided.selected && provided.selected.length > 0
            ? { selected: [...provided.selected] }
            : {}),
        };
      }
      return {
        question: question.question,
        answer: index === 0 ? answer : "",
        isCustomAnswer: index === 0 ? isCustomAnswer : false,
      };
    });
  }
}

export const quizService = new QuizService();
