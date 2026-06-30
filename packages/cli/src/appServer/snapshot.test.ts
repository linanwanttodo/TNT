import {
  ZCODE_PROTOCOL_NAME,
  ZCODE_PROTOCOL_VERSION,
  zcodeMessageWithPartsSchema,
  zcodeSessionInfoSchema,
  zcodeSessionStateSnapshotSchema,
} from "@zcode/shared";
import type {
  ChatHistoryItem,
  ChatMessage,
  Session,
  ToolCallState,
} from "core/index.js";
import { describe, expect, it } from "vitest";

import { setMessageTimestamp } from "../session/store.js";

import {
  toZcodeMessages,
  toZcodeSessionInfo,
  toZcodeSnapshot,
} from "./snapshot.js";

function item(
  message: ChatMessage,
  extra: Partial<ChatHistoryItem> = {},
): ChatHistoryItem {
  return { message, contextItems: [], ...extra };
}

const readFileState: ToolCallState = {
  toolCallId: "call-1",
  toolCall: {
    id: "call-1",
    type: "function",
    function: {
      name: "read_file",
      arguments: '{"path":"notes.txt"}',
    },
  },
  status: "done",
  parsedArgs: { path: "notes.txt" },
  output: [
    {
      content: "file body",
      name: "notes.txt",
      description: "notes",
    },
  ],
};

const fixture: Session = {
  sessionId: "session-fixture",
  title: "Fixture session",
  workspaceDirectory: "/workspace/project",
  history: [
    item({ role: "system", content: "You are a test agent." }),
    item({ role: "user", content: "Please read the file." }),
    item(
      {
        role: "assistant",
        content: "I will read it.",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"notes.txt"}',
            },
          },
        ],
      },
      {
        reasoning: {
          active: false,
          text: "Need the file contents.",
          startAt: 0,
        },
        toolCallStates: [readFileState],
      },
    ),
    item({ role: "tool", content: "file body", toolCallId: "call-1" }),
    item({ role: "thinking", content: "Another thought." }),
    item({ role: "assistant", content: "The file says file body." }),
  ],
};

interface ExpectedMessage {
  index: number;
  role: "user" | "assistant";
  partTypes: string[];
  text?: string;
  reasoning?: string;
  synthetic?: boolean;
  toolCallId?: string;
  toolStatus?: string;
  toolOutput?: string;
}

const expectedMessages: ExpectedMessage[] = [
  {
    index: 0,
    role: "user",
    partTypes: ["text"],
    text: "You are a test agent.",
    synthetic: true,
  },
  {
    index: 1,
    role: "user",
    partTypes: ["text"],
    text: "Please read the file.",
  },
  {
    index: 2,
    role: "assistant",
    partTypes: ["text", "reasoning", "tool"],
    text: "I will read it.",
    reasoning: "Need the file contents.",
    toolCallId: "call-1",
    toolStatus: "completed",
    toolOutput: "file body",
  },
  {
    index: 3,
    role: "assistant",
    partTypes: ["reasoning"],
    reasoning: "Another thought.",
  },
  {
    index: 4,
    role: "assistant",
    partTypes: ["text"],
    text: "The file says file body.",
  },
];

describe("toZcodeMessages", () => {
  const messages = toZcodeMessages(fixture);

  it("folds tool results into the tool call instead of a standalone message", () => {
    expect(messages).toHaveLength(expectedMessages.length);
  });

  it.each(expectedMessages)(
    "maps history item $index to a $role message",
    (expected) => {
      const message = messages[expected.index];
      expect(message.info.role).toBe(expected.role);
      expect(message.parts.map((part) => part.type)).toEqual(
        expected.partTypes,
      );

      const textPart = message.parts.find((part) => part.type === "text");
      if (expected.text !== undefined) {
        expect(textPart && "text" in textPart ? textPart.text : undefined).toBe(
          expected.text,
        );
      }
      if (expected.synthetic) {
        expect(
          textPart && "synthetic" in textPart ? textPart.synthetic : undefined,
        ).toBe(true);
        expect(
          "synthetic" in message.info ? message.info.synthetic : false,
        ).toBe(true);
      }

      const reasoningPart = message.parts.find(
        (part) => part.type === "reasoning",
      );
      if (expected.reasoning !== undefined) {
        expect(
          reasoningPart && "text" in reasoningPart
            ? reasoningPart.text
            : undefined,
        ).toBe(expected.reasoning);
      }

      if (expected.toolCallId) {
        const toolPart = message.parts.find((part) => part.type === "tool");
        expect(
          toolPart && toolPart.type === "tool" ? toolPart.callId : null,
        ).toBe(expected.toolCallId);
        if (toolPart && toolPart.type === "tool") {
          expect(toolPart.state.status).toBe(expected.toolStatus);
          if (toolPart.state.status === "completed") {
            expect(toolPart.state.output).toBe(expected.toolOutput);
          }
        }
      }
    },
  );

  it("emits messages that validate against the vendored schema", () => {
    for (const message of messages) {
      expect(() => zcodeMessageWithPartsSchema.parse(message)).not.toThrow();
    }
  });

  it("keys tool parts by the tool call id", () => {
    const toolPart = messages[2].parts.find((part) => part.type === "tool");
    expect(toolPart?.type).toBe("tool");
    if (toolPart?.type === "tool") {
      expect(toolPart.callId).toBe("call-1");
      expect(toolPart.tool).toBe("read_file");
    }
  });

  it("uses a pending tool state when no result was recorded", () => {
    const session: Session = {
      ...fixture,
      history: [
        item({
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-2",
              type: "function",
              function: { name: "shell", arguments: '{"command":"ls"}' },
            },
          ],
        }),
      ],
    };
    const [message] = toZcodeMessages(session);
    const toolPart = message.parts.find((part) => part.type === "tool");
    if (toolPart?.type !== "tool") {
      throw new Error("expected a tool part");
    }
    expect(toolPart.state.status).toBe("pending");
    if (toolPart.state.status === "pending") {
      expect(toolPart.state.input).toEqual({ command: "ls" });
      expect(toolPart.state.raw).toBe('{"command":"ls"}');
    }
  });
});

describe("toZcodeSessionInfo", () => {
  it("maps the TNT session onto the ZCode schema with safe defaults", () => {
    const info = toZcodeSessionInfo(fixture);

    expect(() => zcodeSessionInfoSchema.parse(info)).not.toThrow();
    expect(info).toMatchObject({
      sessionId: "session-fixture",
      title: "Fixture session",
      sessionKind: "interactive",
      mode: "build",
      status: "idle",
      workspace: {
        workspacePath: "/workspace/project",
        workspaceKey: "/workspace/project",
      },
      createdAt: 0,
      updatedAt: 0,
    });
  });

  it("maps the plan mode and persists metadata timestamps when supplied", () => {
    const info = toZcodeSessionInfo(
      { ...fixture, mode: "plan" },
      {
        meta: {
          dateCreated: "2026-01-02T03:04:05.000Z",
          updatedAt: "2026-01-02T04:05:06.000Z",
        },
      },
    );

    expect(info.mode).toBe("plan");
    expect(info.createdAt).toBe(Date.parse("2026-01-02T03:04:05.000Z"));
    expect(info.updatedAt).toBe(Date.parse("2026-01-02T04:05:06.000Z"));
  });
});

describe("toZcodeSnapshot", () => {
  it("builds a schema-valid snapshot with settings, projection and runtime", () => {
    const model = { providerId: "anthropic", modelId: "claude-sonnet-4-5" };
    const snapshot = toZcodeSnapshot(fixture, {
      meta: {
        dateCreated: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:06.000Z",
      },
      model,
    });

    expect(() => zcodeSessionStateSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.protocol).toEqual({
      name: ZCODE_PROTOCOL_NAME,
      version: ZCODE_PROTOCOL_VERSION,
    });
    expect(snapshot.session.model).toEqual(model);
    expect(snapshot.settings.model.current).toEqual(model);
    expect(snapshot.settings.mode.current).toBe("build");
    expect(snapshot.projection.turnCount).toBe(1);
    expect(snapshot.projection.pendingPermissions).toEqual([]);
    expect(snapshot.runtime).toEqual({
      eventSeq: 0,
      stateRevision: 0,
      pendingRequestIds: [],
    });
    expect(snapshot.messages).toHaveLength(expectedMessages.length);
  });
});

describe("message content and identity projection", () => {
  it("renders the user text instead of the model-facing content with hook notes", () => {
    const session: Session = {
      ...fixture,
      history: [
        item(
          { role: "user", content: "session-start hook note\npicked a file" },
          { userText: "picked a file" },
        ),
      ],
    };

    const [message] = toZcodeMessages(session);
    const textPart = message.parts.find((part) => part.type === "text");
    expect(textPart && "text" in textPart ? textPart.text : undefined).toBe(
      "picked a file",
    );
  });

  it("maps image and audio parts to file parts", () => {
    const session: Session = {
      ...fixture,
      history: [
        item(
          {
            role: "user",
            content: [
              { type: "text", text: "look" },
              {
                type: "imageUrl",
                imageUrl: { url: "data:image/png;base64,AAAA" },
              },
              {
                type: "audio",
                audio: { data: "BBBB", format: "wav" },
              },
            ],
          },
          { userText: "look" },
        ),
      ],
    };

    const [message] = toZcodeMessages(session);
    const files = message.parts.filter((part) => part.type === "file");
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,AAAA",
    });
    expect(files[1]).toMatchObject({
      type: "file",
      mime: "audio/wav",
      url: "data:audio/wav;base64,BBBB",
    });
    expect(() => zcodeMessageWithPartsSchema.parse(message)).not.toThrow();
  });

  it("maps tool calls attached to a thinking message", () => {
    const session: Session = {
      ...fixture,
      history: [
        item(
          {
            role: "thinking",
            content: "planning",
            toolCalls: [
              {
                id: "thinking-call",
                type: "function",
                function: { name: "list_files", arguments: "{}" },
              },
            ],
          },
          {
            toolCallStates: [
              {
                toolCallId: "thinking-call",
                toolCall: {
                  id: "thinking-call",
                  type: "function",
                  function: { name: "list_files", arguments: "{}" },
                },
                status: "done",
                parsedArgs: {},
                output: [{ content: "a.ts", name: "a.ts", description: "" }],
              },
            ],
          },
        ),
      ],
    };

    const [message] = toZcodeMessages(session);
    const toolPart = message.parts.find((part) => part.type === "tool");
    expect(toolPart?.type).toBe("tool");
    if (toolPart?.type === "tool") {
      expect(toolPart.callId).toBe("thinking-call");
      expect(toolPart.state.status).toBe("completed");
    }
  });

  it("does not point a leading assistant message at its own id", () => {
    const session: Session = {
      ...fixture,
      history: [item({ role: "assistant", content: "hello" })],
    };

    const [message] = toZcodeMessages(session);
    expect(message.info.role).toBe("assistant");
    if (message.info.role === "assistant") {
      expect(message.info.parentMessageId).not.toBe(message.info.messageId);
      expect(message.info.parentMessageId).toBe(`${session.sessionId}:root`);
    }
  });

  it("derives the session kind from a subagent session and echoes workspaceIdentity", () => {
    const info = toZcodeSessionInfo(
      { ...fixture, subagentType: "code-reviewer" },
      {
        meta: {
          source: "subagent",
          workspaceIdentity: "remote-workspace-1",
        },
      },
    );

    expect(info.sessionKind).toBe("subagent_child");
    expect(info.workspace.workspaceIdentity).toBe("remote-workspace-1");
    expect(info.workspace.workspaceKey).toBe("remote-workspace-1");
    expect(() => zcodeSessionInfoSchema.parse(info)).not.toThrow();
  });

  it("uses store timestamps and completes the last assistant message when idle", () => {
    const user = item({ role: "user", content: "hi" });
    setMessageTimestamp(user, "2026-02-03T04:05:06.000Z");
    const assistant = item({ role: "assistant", content: "hello" });
    setMessageTimestamp(assistant, "2026-02-03T04:05:07.000Z");
    const session: Session = {
      ...fixture,
      history: [user, assistant],
    };

    const snapshot = toZcodeSnapshot(session, {
      status: "idle",
      meta: {
        dateCreated: "2026-02-03T04:05:05.000Z",
        updatedAt: "2026-02-03T04:05:08.000Z",
      },
    });

    const [userMessage, assistantMessage] = snapshot.messages;
    expect(userMessage.info.time.created).toBe(
      Date.parse("2026-02-03T04:05:06.000Z"),
    );
    expect(assistantMessage.info.time.created).toBe(
      Date.parse("2026-02-03T04:05:07.000Z"),
    );
    expect(assistantMessage.info.role).toBe("assistant");
    if (assistantMessage.info.role === "assistant") {
      expect(assistantMessage.info.time.completed).toBe(
        Date.parse("2026-02-03T04:05:08.000Z"),
      );
    }
    expect(() => zcodeSessionStateSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("leaves the last assistant message open while a turn is running", () => {
    const snapshot = toZcodeSnapshot(fixture, { status: "running" });
    const lastAssistant = [...snapshot.messages]
      .reverse()
      .find((message) => message.info.role === "assistant");

    expect(lastAssistant?.info.role).toBe("assistant");
    if (lastAssistant?.info.role === "assistant") {
      expect(lastAssistant.info.time.completed).toBeUndefined();
    }
  });
});
