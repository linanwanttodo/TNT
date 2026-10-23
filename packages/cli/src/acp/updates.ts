import * as acp from "@agentclientprotocol/sdk";

import type { AgentEvent } from "../protocol/events.js";

const TOOL_KINDS: Record<string, acp.ToolKind> = {
  Read: "read",
  View: "read",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  ApplyPatch: "edit",
  CreateNewFile: "edit",
  Bash: "execute",
  RunTerminalCommand: "execute",
  Search: "search",
  Glob: "search",
  Grep: "search",
  CodebaseSearch: "search",
  ListFiles: "search",
  FindSymbol: "search",
  Fetch: "fetch",
  WebSearch: "fetch",
  Delete: "delete",
  Move: "move",
  Task: "think",
  Think: "think",
};

export function toolKind(toolName: string): acp.ToolKind {
  return TOOL_KINDS[toolName] ?? "other";
}

export function toolTitle(toolName: string, args: unknown): string {
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    for (const key of ["file_path", "filepath", "path", "pattern", "command"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return `${toolName}: ${value.trim().slice(0, 120)}`;
      }
    }
  }
  return toolName;
}

function toolStatus(status: string): acp.ToolCallStatus {
  switch (status) {
    case "done":
      return "completed";
    case "errored":
    case "canceled":
      return "failed";
    case "generated":
    case "generating":
    case "calling":
      return "in_progress";
    default:
      return "pending";
  }
}

function resultContent(result: string): acp.ToolCallContent[] {
  const text =
    result.length > 20_000 ? `${result.slice(0, 20_000)}\n…` : result;
  return [
    {
      type: "content",
      content: { type: "text", text },
    },
  ];
}

export interface UpdateOptions {
  /** The client advertised live notices. */
  notices: boolean;
  /** The client advertised ID-addressed compaction updates. */
  compaction: boolean;
}

/**
 * The engine's event vocabulary is the only input here. A surface may drop an
 * event it cannot express; it must not invent state the engine did not send.
 */
export function eventToUpdate(
  event: AgentEvent,
  options: UpdateOptions,
): acp.SessionUpdate | null {
  switch (event.type) {
    case "content.delta":
      return {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: event.delta },
      };
    case "reasoning.delta":
      return {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: event.delta },
      };
    case "tool.started": {
      const toolCallId = event.toolCallId ?? `tool-${event.seq}`;
      return {
        sessionUpdate: "tool_call",
        toolCallId,
        title: toolTitle(event.toolName, event.args),
        name: event.toolName,
        kind: toolKind(event.toolName),
        status: "in_progress",
        rawInput: event.args,
      };
    }
    case "tool.updated":
      // The start and finish events already carry the lifecycle ACP renders;
      // forwarding every intermediate status would duplicate the same call.
      return null;
    case "tool.finished": {
      if (!event.toolCallId) return null;
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        name: event.toolName,
        status: toolStatus(event.status),
        content: event.result ? resultContent(event.result) : null,
      };
    }
    case "notice":
      if (!options.notices) return null;
      return {
        sessionUpdate: "notice",
        severity: "info",
        title: event.message,
      };
    case "compaction.started":
      if (!options.compaction) return null;
      return {
        sessionUpdate: "compaction_update",
        compactionId: event.turnId,
        status: "in_progress",
      };
    case "compaction.finished":
      if (!options.compaction) return null;
      return {
        sessionUpdate: "compaction_update",
        compactionId: event.turnId,
        status: "completed",
      };
    default:
      return null;
  }
}

export async function sendUpdate(
  client: acp.AgentContext,
  sessionId: string,
  update: acp.SessionUpdate,
): Promise<void> {
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update,
  });
}
