import type {
  ZCodePermissionRequestParams,
  ZCodeUserInputRequestParams,
} from "@zcode/shared";

import type { ToolCallRequest } from "../permissions/types.js";
import type { QuizQuestion } from "../services/QuizService.js";

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
  question: QuizQuestion;
  sessionId: string | null;
  turnId: string | null;
  outgoing: string | null;
}

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

export function userInputParams(
  pending: PendingQuestion,
  sessionId: string,
): ZCodeUserInputRequestParams {
  const choices = pending.question.options ?? [];
  return {
    requestId: pending.requestId,
    sessionId,
    ...(pending.turnId ? { turnId: pending.turnId } : {}),
    prompt: pending.question.question,
    ...(choices.length > 0
      ? {
          questions: [
            {
              question: pending.question.question,
              header: "Q1",
              options: choices.map((choice) => ({
                value: choice,
                label: choice,
              })),
            },
          ],
        }
      : {}),
  };
}

export function choiceForOption(
  question: QuizQuestion,
  optionId: string,
): string | undefined {
  const choices = question.options;
  if (!choices || choices.length === 0) {
    return undefined;
  }
  const match = /^option-(\d+)$/.exec(optionId);
  if (match) {
    return choices[Number(match[1])];
  }
  return choices.includes(optionId) ? optionId : undefined;
}

export function answerFromContent(content: unknown): string {
  const record = asRecord(content);
  if (typeof record.answer === "string") {
    return record.answer;
  }
  const answers = asRecord(record.answers);
  const values = Object.values(answers).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
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
    .find((key) => typeof record[key] === "string");
  return indexed ? String(record[indexed]) : "";
}
