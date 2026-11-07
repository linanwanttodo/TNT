/**
 * One turn of the engine as a flat item list the chat view can render: user
 * and assistant messages, tool cards, errors — plus the in-flight scratch
 * (streaming text, reasoning, pending approval) kept beside them.
 */
import { create } from "zustand";

import type {
  AgentEvent,
  SubagentState,
  ToolStatusName,
} from "../types/agent-events.js";
import {
  changedPaths,
  summarizeChangedFiles,
} from "../ui/chat/changedFiles.js";
import { splitServedPrompt } from "../utils/transcript.js";
import {
  approve as postApproval,
  answerQuestion as postAnswerQuestion,
  chooseModel as postChooseModel,
  chooseWorktree as postChooseWorktree,
  fetchModels as postFetchModels,
  fetchState,
  fetchWorktrees as postFetchWorktrees,
  sendMessage as postMessage,
  startSession as postStartSession,
  switchSession as postSwitchSession,
  type ChatModelOption,
  type WorktreeInfo,
} from "../api/client.js";
import type { ConnStatus } from "../api/client.js";

export interface UserMessageItem {
  kind: "message";
  role: "user";
  text: string;
}

export interface AssistantMessageItem {
  kind: "message";
  role: "assistant";
  text: string;
  streaming?: boolean | undefined;
  changedFiles?: string[] | undefined;
}

export interface ToolCardItem {
  kind: "tool";
  toolCallId?: string;
  toolName: string;
  status: ToolStatusName;
  args?: unknown;
  result?: string;
}

export interface ErrorItem {
  kind: "error";
  text: string;
}

/**
 * A finished block of model reasoning, kept in the transcript in the order it
 * arrived: thinking that led a tool call belongs before it, not at the bottom.
 */
export interface ReasoningItem {
  kind: "reasoning";
  text: string;
}

export type ChatItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolCardItem
  | ReasoningItem
  | ErrorItem;

export interface PendingPermission {
  requestId: string;
  toolName: string;
  toolArgs: unknown;
  preview?: unknown;
}

/** A question the engine is waiting on, as question.requested carries it. */
export interface PendingQuestionState {
  requestId: string;
  question: string;
  options?: string[];
  defaultAnswer?: string;
}

interface SessionState {
  sessionId: string | null;
  /** Title the server gave the conversation, or null before the first turn. */
  title: string | null;
  /** Model label the server reports for the session. */
  chatModelTitle: string | null;
  /** The chat models the session may run on, from GET /models. */
  models: ChatModelOption[];
  /** The model in use, or null before the session reports one. */
  currentModel: ChatModelOption | null;
  /** The repository's checkouts, from GET /worktrees. */
  worktrees: WorktreeInfo[];
  /** The checkout the process is in, or null outside a repository. */
  currentWorktree: WorktreeInfo | null;
  /** Whether the page may move the process into another checkout. */
  worktreeSwitchable: boolean;
  /** True once a checkout has been picked in this page session. */
  worktreeChosen: boolean;
  /** True while the server is running a turn. */
  isProcessing: boolean;
  items: ChatItem[];
  /** Assistant text still arriving; null between turns. */
  streaming: string | null;
  /** Reasoning still arriving; settled into an item when anything follows it. */
  reasoning: string | null;
  /**
   * Whether this turn already settled streamed prose into items: once it has,
   * the turn-completed payload repeats those segments and only the tail after
   * the last card is new.
   */
  flushedSegments: boolean;
  isWaiting: boolean;
  pendingPermission: PendingPermission | null;
  /** A question the engine is waiting on (the askQuestion tool). */
  pendingQuestion: PendingQuestionState | null;
  notices: string[];
  status: ConnStatus;
  queueLength: number;
  subagents: SubagentState[];
  pendingChangedFiles: string[];
  seenTurnId: string | null;
  seenSeq: number;
  applyEvent: (event: AgentEvent) => void;
  hydrate: (state: {
    history?: unknown[];
    session?: { history?: unknown[] } | unknown;
    pendingPermission?: unknown;
    isProcessing?: unknown;
    subagents?: SubagentState[];
  }) => void;
  send: (text: string) => Promise<void>;
  approve: (approved: boolean) => Promise<void>;
  /** Answer the engine's pending question through the broker. */
  answerPendingQuestion: (answer: string) => Promise<void>;
  /**
   * Point the server at a saved conversation. Resolves with the session id
   * on success, or null when the server refused (the transcript stays).
   */
  switchTo: (sessionId: string) => Promise<string | null>;
  /**
   * Start a fresh conversation. Resolves with the new session id, or null
   * when the server refused (the transcript stays).
   */
  startNew: () => Promise<string | null>;
  /** Re-pull the model list and the model in use. */
  refreshModels: () => Promise<void>;
  /** Switch the session to the model at this position in the list. */
  pickModel: (index: number) => Promise<void>;
  /** Re-pull the checkouts and the one the process is in. */
  refreshWorktrees: () => Promise<void>;
  /** Move the process into this checkout, marking the chip as chosen. */
  pickWorktree: (path: string) => Promise<void>;
  setStatus: (status: ConnStatus) => void;
}

/**
 * Closes the reasoning scratch into the transcript. Reasoning is only ever
 * shown in order, so whatever follows it - an answer, a tool call, the end of
 * the turn - settles it first.
 */
function settleReasoning(state: {
  items: ChatItem[];
  reasoning: string | null;
}): { items: ChatItem[]; reasoning: null } {
  const text = state.reasoning;
  if (text === null || text.trim() === "") {
    return { items: state.items, reasoning: null };
  }
  return {
    items: [...state.items, { kind: "reasoning", text }],
    reasoning: null,
  };
}

/**
 * Settles the streamed prose into an item so it lands above whatever follows
 * it. Left in the buffer it would only appear at turn.completed, i.e. below
 * every tool card the same turn produced.
 */
function settleStreaming(state: {
  items: ChatItem[];
  streaming: string | null;
}): { items: ChatItem[]; streaming: string | null; flushed: boolean } {
  const text = state.streaming;
  if (text === null || text.trim() === "") {
    return {
      items: state.items,
      streaming: state.streaming,
      flushed: false,
    };
  }
  return {
    items: [...state.items, { kind: "message", role: "assistant", text }],
    streaming: null,
    flushed: true,
  };
}

/** The text a stored tool result carries, for the card a reload rebuilds. */
function toolResultText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  const texts = output
    .map((entry) => (entry as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string" && text !== "");
  return texts.length > 0 ? texts.join("\n") : undefined;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionId: null,
  title: null,
  chatModelTitle: null,
  models: [],
  currentModel: null,
  worktrees: [],
  currentWorktree: null,
  worktreeSwitchable: false,
  worktreeChosen: false,
  isProcessing: false,
  items: [],
  streaming: null,
  reasoning: null,
  flushedSegments: false,
  isWaiting: false,
  pendingPermission: null,
  pendingQuestion: null,
  notices: [],
  status: "live",
  queueLength: 0,
  subagents: [],
  pendingChangedFiles: [],
  /** The seq watermark per turn; late SSE retries must not replay old events. */
  seenTurnId: null,
  seenSeq: -1,

  applyEvent: (event) => {
    if (event.turnId !== get().seenTurnId) {
      set({ seenTurnId: event.turnId, seenSeq: -1 });
    }
    if (event.seq <= get().seenSeq) return;
    set({ seenSeq: event.seq });

    const items = get().items;

    switch (event.type) {
      case "turn.started":
        set({
          isWaiting: true,
          isProcessing: true,
          pendingPermission: null,
          pendingQuestion: null,
          seenTurnId: event.turnId,
          flushedSegments: false,
        });
        break;
      case "content.delta": {
        const settled = settleReasoning(get());
        set({
          ...settled,
          streaming: (get().streaming ?? "") + event.delta,
        });
        break;
      }
      case "reasoning.delta":
        set({ reasoning: (get().reasoning ?? "") + event.delta });
        break;
      case "tool.started": {
        const card: ToolCardItem = {
          kind: "tool",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "calling",
          args: event.args,
        };
        const settled = settleReasoning(get());
        // Prose streamed before this call settles above its card, so the
        // answer reads in the order the model produced it.
        const withText = settleStreaming({
          items: settled.items,
          streaming: get().streaming,
        });
        set({
          items: [...withText.items, card],
          reasoning: settled.reasoning,
          streaming: withText.streaming,
          flushedSegments: withText.flushed ? true : get().flushedSegments,
        });
        break;
      }
      case "tool.updated": {
        const next = items.map((item) =>
          item.kind === "tool" && item.toolCallId === event.toolCallId
            ? { ...item, status: event.status }
            : item,
        );
        set({ items: next });
        break;
      }
      case "tool.finished": {
        const next = items.map((item) =>
          item.kind === "tool" && item.toolCallId === event.toolCallId
            ? { ...item, status: event.status, result: event.result }
            : item,
        );
        const paths =
          event.status === "done"
            ? changedPaths(event.toolName, event.args)
            : [];
        if (paths.length > 0) {
          const pending = [...get().pendingChangedFiles, ...paths];
          set({ pendingChangedFiles: [...new Set(pending)] });
        }
        set({ items: next });
        break;
      }
      case "permission.requested":
        set({
          pendingPermission: {
            requestId: event.requestId,
            toolName: event.toolName,
            toolArgs: event.toolArgs,
            preview: event.preview,
          },
        });
        break;
      case "subagent.started":
        set({
          subagents: [
            ...get().subagents,
            {
              name: event.agentName,
              prompt: event.prompt,
              status: "running",
              startedAt: Date.now(),
            },
          ],
        });
        break;
      case "subagent.reported":
        set({
          subagents: get().subagents.map((agent) =>
            agent.name === event.agentName
              ? { ...agent, content: event.content }
              : agent,
          ),
        });
        break;
      case "subagent.finished":
        set({
          subagents: get().subagents.map((agent) =>
            agent.name === event.agentName
              ? {
                  ...agent,
                  status: "finished",
                  content: event.content,
                  success: event.success,
                  verdict: event.verdict,
                }
              : agent,
          ),
        });
        break;
      case "question.requested":
        // The engine is waiting on this answer (the askQuestion tool blocks
        // until quizService resolves), so it gets an interactive card.
        set({
          pendingQuestion: {
            requestId: event.requestId,
            question: event.question,
            options: event.options ? [...event.options] : undefined,
            defaultAnswer: event.defaultAnswer,
          },
        });
        break;
      case "question.answered":
        // Another tab answered it; drop the card unless a newer question
        // replaced it in the meantime.
        if (get().pendingQuestion?.requestId === event.requestId) {
          set({ pendingQuestion: null });
        }
        break;
      case "notice":
        set({ notices: [...get().notices, event.message] });
        break;
      case "compaction.started":
      case "compaction.finished":
      case "queue.changed":
        if (event.type === "queue.changed") {
          set({ queueLength: event.length });
        }
        break;
      case "turn.completed": {
        // Once segments are settled, the server's full-turn content repeats
        // them; only the tail after the last card is new.
        const text = get().flushedSegments
          ? (get().streaming ?? "")
          : (event.content ?? get().streaming ?? "");
        const changedFiles = summarizeChangedFiles(get().pendingChangedFiles);
        const message: AssistantMessageItem = {
          kind: "message",
          role: "assistant",
          text,
          changedFiles,
        };
        const settled = settleReasoning(get());
        set({
          pendingChangedFiles: [],
          items: [...settled.items, message],
          streaming: null,
          reasoning: null,
          isWaiting: false,
          isProcessing: false,
          flushedSegments: false,
        });
        break;
      }
      case "turn.failed": {
        const settled = settleReasoning(get());
        set({
          items: [...settled.items, { kind: "error", text: event.message }],
          streaming: null,
          reasoning: null,
          isWaiting: false,
          isProcessing: false,
        });
        break;
      }
      case "turn.interrupted": {
        const settled = settleReasoning(get());
        const changedFiles = summarizeChangedFiles(get().pendingChangedFiles);
        if (changedFiles.length > 0) {
          const message: AssistantMessageItem = {
            kind: "message",
            role: "assistant",
            text: get().streaming ?? "",
            changedFiles,
          };
          set({ items: [...settled.items, message] });
        }
        set({ pendingChangedFiles: [] });
        set({
          ...settled,
          streaming: null,
          isWaiting: false,
          isProcessing: false,
        });
        break;
      }
      case "model.changed":
        // Another surface switched the model; the chip re-pulls the list.
        void get().refreshModels();
        break;
      case "workspace.changed":
        // Another surface moved the process; the chip re-pulls the checkouts.
        void get().refreshWorktrees();
        break;
      case "session.changed":
        // Another tab pointed the process at a different conversation; this
        // tab re-pulls the snapshot rather than trusting the bare event.
        set({ items: [], streaming: null, isWaiting: false, sessionId: null });
        void fetchState()
          .then((snapshot) => {
            const current = get();
            // Only apply if no local switch landed in between.
            if (current.sessionId === null) get().hydrate(snapshot);
          })
          .catch(() => {});
        break;
    }
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    set({
      items: [...get().items, { kind: "message", role: "user", text: trimmed }],
      isWaiting: true,
    });
    try {
      await postMessage(trimmed);
    } catch (error) {
      set({
        isWaiting: false,
        items: [
          ...get().items,
          {
            kind: "error",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  },

  approve: async (approved) => {
    const pending = get().pendingPermission;
    if (pending === null) return;
    try {
      await postApproval(pending.requestId, approved);
      // Clear only once the broker has the answer; a failed POST leaves the
      // card up so the user can retry.
      set({ pendingPermission: null });
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  },

  answerPendingQuestion: async (answer) => {
    const pending = get().pendingQuestion;
    if (pending === null) return;
    try {
      // Clear only once the broker has the answer; a failed POST leaves the
      // card up so the user can retry or pick another option.
      await postAnswerQuestion(pending.requestId, answer);
      if (get().pendingQuestion?.requestId === pending.requestId) {
        set({ pendingQuestion: null });
      }
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  },

  hydrate: (state) => {
    // /state nests the transcript under session.history; some callers pass a
    // bare {history} shape. Both must seed the transcript.
    const isProcessing = (state as { isProcessing?: unknown }).isProcessing;
    const isWaiting = (state as { isWaiting?: unknown }).isWaiting;
    const queueLength = (state as { messageQueueLength?: unknown })
      .messageQueueLength;
    const session = (state.session ?? {}) as {
      sessionId?: unknown;
      title?: unknown;
      chatModelTitle?: unknown;
      history?: unknown[];
    };
    const history = state.history ?? session.history ?? [];
    // Everything a stored turn carried is shown: the thinking that led it, the
    // tool calls it made and their results, and only the user's own words in
    // place of the notes the harness led their message with.
    const items = history.flatMap((raw): ChatItem[] => {
      const item = raw as {
        message?: { role?: string; content?: unknown };
        reasoning?: { text?: unknown };
        toolCallStates?: unknown[];
      };
      const out: ChatItem[] = [];
      const reasoning =
        typeof item.reasoning?.text === "string" ? item.reasoning.text : "";
      if (reasoning.trim() !== "")
        out.push({ kind: "reasoning", text: reasoning });
      const message = item.message;
      if (message && typeof message.content === "string") {
        const stored = message.content;
        const text =
          message.role === "user" ? splitServedPrompt(stored).userText : stored;
        if (message.role === "user" || message.role === "assistant") {
          if (text.trim() !== "")
            out.push({ kind: "message", role: message.role, text });
        }
      }
      for (const entry of item.toolCallStates ?? []) {
        const state = entry as {
          toolCallId?: unknown;
          status?: unknown;
          parsedArgs?: unknown;
          output?: unknown;
          toolCall?: { function?: { name?: unknown } };
        };
        const toolName = state.toolCall?.function?.name;
        if (typeof toolName !== "string" || toolName === "") continue;
        out.push({
          kind: "tool",
          toolCallId:
            typeof state.toolCallId === "string" ? state.toolCallId : undefined,
          toolName,
          status: (state.status ?? "done") as ToolStatusName,
          args: state.parsedArgs,
          result: toolResultText(state.output),
        });
      }
      return out;
    });
    const pending = state.pendingPermission as
      | {
          requestId?: unknown;
          toolName?: unknown;
          toolArgs?: unknown;
          toolCallPreview?: unknown;
          question?: unknown;
          options?: unknown;
          defaultAnswer?: unknown;
        }
      | null
      | undefined;
    // The snapshot folds the engine's pending question into the same field
    // as a pending permission; a question-shaped entry goes to the question
    // card (its answer is a text, not an approval).
    const questionPending =
      pending &&
      typeof pending.requestId === "string" &&
      typeof pending.question === "string"
        ? {
            requestId: pending.requestId,
            question: pending.question,
            options: Array.isArray(pending.options)
              ? pending.options.filter(
                  (option): option is string => typeof option === "string",
                )
              : undefined,
            defaultAnswer:
              typeof pending.defaultAnswer === "string"
                ? pending.defaultAnswer
                : undefined,
          }
        : null;
    set({
      sessionId:
        typeof session.sessionId === "string"
          ? session.sessionId
          : get().sessionId,
      title: typeof session.title === "string" ? session.title : get().title,
      chatModelTitle:
        typeof session.chatModelTitle === "string"
          ? session.chatModelTitle
          : get().chatModelTitle,
      isProcessing: isProcessing === true,
      isWaiting: isWaiting === true || isProcessing === true,
      queueLength:
        typeof queueLength === "number" ? queueLength : get().queueLength,
      items,
      pendingQuestion: questionPending,
      pendingPermission:
        pending &&
        typeof pending.requestId === "string" &&
        typeof pending.toolName === "string"
          ? {
              requestId: pending.requestId,
              toolName: pending.toolName,
              toolArgs: pending.toolArgs,
              preview: pending.toolCallPreview,
            }
          : null,
      subagents: Array.isArray(state.subagents) ? state.subagents : [],
    });
  },

  switchTo: async (sessionId) => {
    try {
      const snapshot = await postSwitchSession(sessionId);
      get().hydrate(snapshot);
      set({
        // A stale watermark from the old conversation must not swallow the
        // new session's first turn events.
        streaming: null,
        reasoning: null,
        isWaiting: false,
        notices: [],
        seenTurnId: null,
        seenSeq: -1,
        flushedSegments: false,
      });
      return (snapshot.session as { sessionId?: string }).sessionId ?? null;
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
      return null;
    }
  },

  startNew: async () => {
    try {
      const snapshot = await postStartSession();
      get().hydrate(snapshot);
      set({
        streaming: null,
        reasoning: null,
        isWaiting: false,
        notices: [],
        seenTurnId: null,
        seenSeq: -1,
        flushedSegments: false,
      });
      return (snapshot.session as { sessionId?: string }).sessionId ?? null;
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
      return null;
    }
  },

  refreshModels: async () => {
    try {
      const body = await postFetchModels();
      const current = body.current ?? null;
      set({
        models: body.models,
        currentModel: current,
        chatModelTitle: current?.name ?? get().chatModelTitle,
      });
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  },

  pickModel: async (index) => {
    try {
      const model = await postChooseModel(index);
      set({
        currentModel: model,
        chatModelTitle: model.name,
        models: get().models.map((option) => ({
          ...option,
          current: option.index === model.index,
        })),
      });
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  },

  refreshWorktrees: async () => {
    try {
      const body = await postFetchWorktrees();
      set({
        worktrees: body.worktrees,
        currentWorktree: body.current ?? null,
        worktreeSwitchable: body.switchable,
      });
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  },

  pickWorktree: async (path) => {
    try {
      const worktree = await postChooseWorktree(path);
      set({
        currentWorktree: worktree,
        // The chip carries the accent once the user has picked a checkout;
        // grey is the resting state, not "attached to a worktree".
        worktreeChosen: true,
      });
    } catch (error) {
      set({
        notices: [
          ...get().notices,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  },

  setStatus: (status) => set({ status }),
}));
