/**
 * One turn of the engine as a flat item list the chat view can render: user
 * and assistant messages, tool cards, errors — plus the in-flight scratch
 * (streaming text, reasoning, pending approval) kept beside them.
 */
import { create } from "zustand";

import type { AgentEvent, ToolStatusName } from "../types/agent-events.js";
import {
  approve as postApproval,
  sendMessage as postMessage,
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

export type ChatItem =
  UserMessageItem | AssistantMessageItem | ToolCardItem | ErrorItem;

export interface PendingPermission {
  requestId: string;
  toolName: string;
  toolArgs: unknown;
  preview?: unknown;
}

interface SessionState {
  items: ChatItem[];
  /** Assistant text still arriving; null between turns. */
  streaming: string | null;
  reasoning: string | null;
  isWaiting: boolean;
  pendingPermission: PendingPermission | null;
  notices: string[];
  status: ConnStatus;
  queueLength: number;
  seenTurnId: string | null;
  seenSeq: number;
  applyEvent: (event: AgentEvent) => void;
  hydrate: (state: {
    history?: unknown[];
    pendingPermission?: unknown;
  }) => void;
  send: (text: string) => Promise<void>;
  approve: (approved: boolean) => Promise<void>;
  setStatus: (status: ConnStatus) => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  items: [],
  streaming: null,
  reasoning: null,
  isWaiting: false,
  pendingPermission: null,
  notices: [],
  status: "live",
  queueLength: 0,
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
        set({ isWaiting: true, pendingPermission: null });
        break;
      case "content.delta":
        set({ streaming: (get().streaming ?? "") + event.delta });
        break;
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
        set({ items: [...items, card] });
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
      case "question.requested":
        // The question flow is a later task; surface it as a notice for now.
        set({ notices: [...get().notices, event.question] });
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
        const text = event.content ?? get().streaming ?? "";
        const message: AssistantMessageItem = {
          kind: "message",
          role: "assistant",
          text,
        };
        set({
          items: [...items, message],
          streaming: null,
          reasoning: null,
          isWaiting: false,
        });
        break;
      }
      case "turn.failed":
        set({
          items: [...items, { kind: "error", text: event.message }],
          streaming: null,
          reasoning: null,
          isWaiting: false,
        });
        break;
      case "turn.interrupted":
        set({ streaming: null, reasoning: null, isWaiting: false });
        break;
      case "session.changed":
        set({ items: [], streaming: null, isWaiting: false });
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

  hydrate: (state) => {
    const items = (state.history ?? []).flatMap((item): ChatItem[] => {
      const message = (
        item as { message?: { role?: string; content?: unknown } }
      ).message;
      if (!message || typeof message.content !== "string") return [];
      if (message.role === "user" || message.role === "assistant") {
        return [{ kind: "message", role: message.role, text: message.content }];
      }
      return [];
    });
    const pending = state.pendingPermission as
      | {
          requestId?: unknown;
          toolName?: unknown;
          toolArgs?: unknown;
          toolCallPreview?: unknown;
        }
      | null
      | undefined;
    set({
      items,
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
    });
  },

  setStatus: (status) => set({ status }),
}));
