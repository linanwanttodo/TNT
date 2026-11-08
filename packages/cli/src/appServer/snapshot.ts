/* eslint-disable max-lines -- the message projection keeps every part shape in one place */
import { ZCODE_PROTOCOL_NAME, ZCODE_PROTOCOL_VERSION } from "@zcode/shared";
import type {
  ModelSelection,
  ZCodeMessagePart,
  ZCodeMessageWithParts,
  ZCodeSessionKind,
  ZCodeSessionInfo,
  ZCodeSessionMode,
  ZCodeSessionStateSnapshot,
  ZCodeToolState,
} from "@zcode/shared";
import type {
  AssistantChatMessage,
  ChatHistoryItem,
  MessageContent,
  Session,
  ThinkingChatMessage,
  ToolCallDelta,
  ToolCallState,
} from "core/index.js";

import { DEFAULT_SESSION_TITLE } from "../config/constants.js";
import { messageTimestampOf, type SessionMeta } from "../session/store.js";

const DEFAULT_AGENT = "tnt";

export type SessionStatus =
  "idle" | "running" | "waiting" | "paused" | "completed" | "error";

export interface SessionInfoContext {
  meta?: Partial<SessionMeta> | null;
  model?: ModelSelection;
  status?: SessionStatus;
}

export interface SnapshotContext extends SessionInfoContext {
  messages?: ZCodeMessageWithParts[];
  runtime?: { eventSeq: number; stateRevision: number };
}

type ItemWithMessageId = ChatHistoryItem & { messageId?: string };
type ItemWithUserText = ChatHistoryItem & { userText?: string };

interface MessageContext {
  session: Session;
  messageId: string;
  parentMessageId: string;
  created: number;
  model?: ModelSelection;
  results: Map<string, string>;
}

interface FileProjection {
  mime: string;
  url: string;
  filename?: string;
}

interface ContentProjection {
  text: string;
  files: FileProjection[];
}

function workspacePathOf(session: Session): string {
  const declared = session.workspaceDirectory?.trim();
  return declared && declared.length > 0 ? declared : process.cwd();
}

function timestampOf(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function itemTimestampOf(item: ChatHistoryItem): number {
  return timestampOf(messageTimestampOf(item));
}

function mimeFromDataUrl(url: string, fallback: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(url);
  return match?.[1] ?? fallback;
}

function contentProjection(
  content: MessageContent,
  displayText?: string,
): ContentProjection {
  if (typeof content === "string") {
    return { text: displayText ?? content, files: [] };
  }
  if (!Array.isArray(content)) {
    return { text: displayText ?? "", files: [] };
  }
  const texts: string[] = [];
  const files: FileProjection[] = [];
  content.forEach((part, index) => {
    if (part.type === "text") {
      texts.push(part.text);
      return;
    }
    if (part.type === "imageUrl") {
      const url = part.imageUrl.url;
      files.push({
        mime: mimeFromDataUrl(url, "image/*"),
        url,
        filename: `attachment-${index + 1}`,
      });
      return;
    }
    if (part.type === "audio") {
      const mime = `audio/${part.audio.format}`;
      files.push({
        mime,
        url: `data:${mime};base64,${part.audio.data}`,
        filename: `attachment-${index + 1}`,
      });
    }
  });
  return {
    text: displayText === undefined ? texts.join("") : displayText,
    files,
  };
}

function toZcodeMode(mode: Session["mode"]): ZCodeSessionMode {
  return mode === "plan" ? "plan" : "build";
}

function sessionKindOf(
  session: Session,
  meta: Partial<SessionMeta> | null | undefined,
): ZCodeSessionKind {
  if (session.subagentType || meta?.source === "subagent") {
    return "subagent_child";
  }
  return "interactive";
}

function messageIdFor(
  item: ChatHistoryItem,
  index: number,
  sessionId: string,
): string {
  const carried = (item as ItemWithMessageId).messageId;
  return carried && carried.length > 0 ? carried : `${sessionId}:msg-${index}`;
}

function contentText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function asInput(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    return asInput(JSON.parse(raw));
  } catch {
    return {};
  }
}

function contextOutput(state: ToolCallState | undefined): string {
  return (state?.output ?? []).map((item) => item.content).join("\n");
}

function toolStateOf(
  state: ToolCallState,
  fallbackOutput: string,
): ZCodeToolState {
  const name = state.toolCall.function.name || "tool";
  const input = asInput(state.parsedArgs);
  const output = contextOutput(state) || fallbackOutput;
  const raw = state.toolCall.function.arguments ?? "";
  if (state.status === "done") {
    return {
      status: "completed",
      input,
      output,
      title: name,
      metadata: {},
      startedAt: 0,
      completedAt: 0,
    };
  }
  if (state.status === "errored") {
    return {
      status: "error",
      input,
      error: output || "Tool call failed",
      startedAt: 0,
      completedAt: 0,
    };
  }
  if (state.status === "canceled") {
    return {
      status: "error",
      input,
      error: output || "Tool call canceled",
      startedAt: 0,
      completedAt: 0,
    };
  }
  if (state.status === "calling") {
    return { status: "running", input, startedAt: 0 };
  }
  return { status: "pending", input, raw };
}

interface ToolPartInit {
  sessionId: string;
  messageId: string;
  partId: string;
  callId: string;
  name: string;
  state: ZCodeToolState;
}

function toolPart(init: ToolPartInit): ZCodeMessagePart {
  return {
    type: "tool",
    partId: init.partId,
    sessionId: init.sessionId,
    messageId: init.messageId,
    callId: init.callId,
    tool: init.name || "tool",
    state: init.state,
  };
}

function toolPartsFromStates(
  states: readonly ToolCallState[],
  context: MessageContext,
): ZCodeMessagePart[] {
  return states.map((state, index) => {
    const callId = state.toolCallId || `${context.messageId}:call-${index}`;
    return toolPart({
      sessionId: context.session.sessionId,
      messageId: context.messageId,
      partId: `${context.messageId}:part-tool-${index}`,
      callId,
      name: state.toolCall.function.name,
      state: toolStateOf(state, context.results.get(callId) ?? ""),
    });
  });
}

function toolPartsFromCalls(
  calls: readonly ToolCallDelta[],
  context: MessageContext,
): ZCodeMessagePart[] {
  return calls.map((call, index) => {
    const callId =
      call.id && call.id.length > 0
        ? call.id
        : `${context.messageId}:call-${index}`;
    const name = call.function?.name ?? "";
    const raw = call.function?.arguments ?? "";
    const result = context.results.get(callId);
    const state: ZCodeToolState =
      result === undefined
        ? { status: "pending", input: parseArguments(raw), raw }
        : {
            status: "completed",
            input: parseArguments(raw),
            output: result,
            title: name || "tool",
            metadata: {},
            startedAt: 0,
            completedAt: 0,
          };
    return toolPart({
      sessionId: context.session.sessionId,
      messageId: context.messageId,
      partId: `${context.messageId}:part-tool-${index}`,
      callId,
      name,
      state,
    });
  });
}

function collectToolResults(history: ChatHistoryItem[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const item of history) {
    if (item.message.role === "tool") {
      results.set(item.message.toolCallId, item.message.content);
    }
  }
  return results;
}

function assistantInfo(
  context: MessageContext,
  usage: AssistantChatMessage["usage"],
): ZCodeMessageWithParts["info"] {
  const workspacePath = workspacePathOf(context.session);
  const info: ZCodeMessageWithParts["info"] = {
    messageId: context.messageId,
    sessionId: context.session.sessionId,
    role: "assistant",
    time: { created: context.created },
    parentMessageId: context.parentMessageId,
    agent: DEFAULT_AGENT,
    path: { cwd: workspacePath, root: workspacePath },
    cost: 0,
    tokens: {
      input: usage?.promptTokens ?? 0,
      output: usage?.completionTokens ?? 0,
      reasoning: usage?.completionTokensDetails?.reasoningTokens ?? 0,
      cache: {
        read: usage?.promptTokensDetails?.cachedTokens ?? 0,
        write: usage?.promptTokensDetails?.cacheWriteTokens ?? 0,
      },
    },
  };
  if (context.model) {
    info.model = context.model;
  }
  return info;
}

function userMessage(
  item: ChatHistoryItem,
  context: MessageContext,
  synthetic: boolean,
): ZCodeMessageWithParts {
  const partId = `${context.messageId}:part-text`;
  const projection = contentProjection(
    item.message.content,
    (item as ItemWithUserText).userText,
  );
  const info: ZCodeMessageWithParts["info"] = synthetic
    ? {
        messageId: context.messageId,
        sessionId: context.session.sessionId,
        role: "user",
        time: { created: context.created },
        agent: DEFAULT_AGENT,
        synthetic: true,
      }
    : {
        messageId: context.messageId,
        sessionId: context.session.sessionId,
        role: "user",
        time: { created: context.created },
        agent: DEFAULT_AGENT,
      };
  const parts: ZCodeMessagePart[] = [
    synthetic
      ? {
          type: "text",
          partId,
          sessionId: context.session.sessionId,
          messageId: context.messageId,
          text: projection.text,
          synthetic: true,
        }
      : {
          type: "text",
          partId,
          sessionId: context.session.sessionId,
          messageId: context.messageId,
          text: projection.text,
        },
  ];
  projection.files.forEach((file, index) => {
    parts.push({
      type: "file",
      partId: `${context.messageId}:part-file-${index}`,
      sessionId: context.session.sessionId,
      messageId: context.messageId,
      mime: file.mime,
      url: file.url,
      ...(file.filename ? { filename: file.filename } : {}),
    });
  });
  return { info, parts };
}

function thinkingMessage(
  item: ChatHistoryItem,
  context: MessageContext,
): ZCodeMessageWithParts {
  const message = item.message as ThinkingChatMessage;
  const parts: ZCodeMessagePart[] = [
    {
      type: "reasoning",
      partId: `${context.messageId}:part-reasoning`,
      sessionId: context.session.sessionId,
      messageId: context.messageId,
      text: contentText(message.content),
    },
  ];
  const states = item.toolCallStates ?? [];
  if (states.length > 0) {
    parts.push(...toolPartsFromStates(states, context));
  } else {
    parts.push(...toolPartsFromCalls(message.toolCalls ?? [], context));
  }
  return {
    info: assistantInfo(context, undefined),
    parts,
  };
}

function assistantMessage(
  item: ChatHistoryItem,
  context: MessageContext,
): ZCodeMessageWithParts {
  const message = item.message as AssistantChatMessage;
  const parts: ZCodeMessagePart[] = [];
  const text = contentText(message.content);
  if (text.length > 0) {
    parts.push({
      type: "text",
      partId: `${context.messageId}:part-text`,
      sessionId: context.session.sessionId,
      messageId: context.messageId,
      text,
    });
  }
  const reasoning = item.reasoning?.text;
  if (reasoning && reasoning.length > 0) {
    parts.push({
      type: "reasoning",
      partId: `${context.messageId}:part-reasoning`,
      sessionId: context.session.sessionId,
      messageId: context.messageId,
      text: reasoning,
    });
  }
  const states = item.toolCallStates ?? [];
  if (states.length > 0) {
    parts.push(...toolPartsFromStates(states, context));
  } else {
    parts.push(...toolPartsFromCalls(message.toolCalls ?? [], context));
  }
  return {
    info: assistantInfo(context, message.usage),
    parts,
  };
}

export function toZcodeMessages(session: Session): ZCodeMessageWithParts[] {
  const results = collectToolResults(session.history);
  const messages: ZCodeMessageWithParts[] = [];
  let lastUserMessageId: string | undefined;
  let lastMessageId: string | undefined;

  session.history.forEach((item, index) => {
    const role = item.message.role;
    if (role === "tool") {
      return;
    }
    const messageId = messageIdFor(item, index, session.sessionId);
    const context: MessageContext = {
      session,
      messageId,
      parentMessageId:
        lastUserMessageId ?? lastMessageId ?? `${session.sessionId}:root`,
      created: itemTimestampOf(item),
      model: undefined,
      results,
    };
    lastMessageId = messageId;
    if (role === "user") {
      lastUserMessageId = messageId;
      messages.push(userMessage(item, context, false));
      return;
    }
    if (role === "system") {
      messages.push(userMessage(item, context, true));
      return;
    }
    if (role === "thinking") {
      messages.push(thinkingMessage(item, context));
      return;
    }
    messages.push(assistantMessage(item, context));
  });

  return messages;
}

export function toZcodeSessionInfo(
  session: Session,
  context: SessionInfoContext = {},
): ZCodeSessionInfo {
  const workspacePath = workspacePathOf(session);
  const workspaceIdentity = context.meta?.workspaceIdentity?.trim();
  const workspaceKey = workspaceIdentity || workspacePath;
  const info: ZCodeSessionInfo = {
    sessionId: session.sessionId,
    workspace: {
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      workspaceKey,
    },
    sessionKind: sessionKindOf(session, context.meta),
    title: session.title || DEFAULT_SESSION_TITLE,
    mode: toZcodeMode(session.mode),
    status: context.status ?? "idle",
    createdAt: timestampOf(context.meta?.dateCreated),
    updatedAt: timestampOf(context.meta?.updatedAt),
  };
  if (session.parentSessionId) {
    info.parentSessionId = session.parentSessionId;
  }
  if (context.model) {
    info.model = context.model;
  }
  return info;
}

function markLastAssistantCompleted(
  messages: ZCodeMessageWithParts[],
  fallbackTimestamp: number,
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role !== "assistant") {
      continue;
    }
    if (info.time.completed === undefined) {
      info.time.completed = Math.max(info.time.created, fallbackTimestamp);
    }
    return;
  }
}

function totalTokenCount(session: Session): number {
  return (
    (session.usage?.promptTokens ?? 0) + (session.usage?.completionTokens ?? 0)
  );
}

export function toZcodeSnapshot(
  session: Session,
  context: SnapshotContext = {},
): ZCodeSessionStateSnapshot {
  const info = toZcodeSessionInfo(session, context);
  const messages = context.messages ?? toZcodeMessages(session);
  if (info.status === "idle" || info.status === "completed") {
    markLastAssistantCompleted(messages, timestampOf(context.meta?.updatedAt));
  }
  return {
    protocol: { name: ZCODE_PROTOCOL_NAME, version: ZCODE_PROTOCOL_VERSION },
    session: info,
    settings: {
      model: context.model
        ? { current: context.model, lastUsed: context.model, available: [] }
        : { available: [] },
      thoughtLevel: { enabled: false, available: [] },
      mode: { current: info.mode },
    },
    projection: {
      sessionId: session.sessionId,
      status: info.status,
      mode: info.mode,
      turnCount: session.history.filter((item) => item.message.role === "user")
        .length,
      totalTokenCount: totalTokenCount(session),
      contextUsed: 0,
      contextWindow: 0,
      pendingPermissions: [],
      activeToolCalls: [],
      backgroundJobs: [],
    },
    runtime: {
      eventSeq: context.runtime?.eventSeq ?? 0,
      stateRevision: context.runtime?.stateRevision ?? 0,
      pendingRequestIds: [],
    },
    messages,
  };
}
