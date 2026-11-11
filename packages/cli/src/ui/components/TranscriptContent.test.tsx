import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { useMessageRenderer } from "../hooks/useMessageRenderer.js";

import { TranscriptContent } from "./TranscriptContent.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30, isResizing: false }),
}));

vi.mock("../IntroMessage.js", () => ({
  IntroMessage: () => <Text>TNT banner</Text>,
}));

const item = (role: string, content: string): ChatHistoryItem =>
  ({ message: { role, content }, contextItems: [] }) as ChatHistoryItem;

const noMetrics = vi.fn();

const renderTranscript = (
  chatHistory: ChatHistoryItem[],
  {
    showIntroMessage = false,
    queued = [],
    streamingReasoning = null,
  }: {
    showIntroMessage?: boolean;
    queued?: Array<{ message: string }>;
    streamingReasoning?: string | null;
  } = {},
) =>
  render(
    <TranscriptContent
      showIntroMessage={showIntroMessage}
      chatHistory={chatHistory}
      queuedMessages={queued as never}
      renderMessage={(message, index) => (
        <Text key={index}>{String(message.message.content)}</Text>
      )}
      streamingReasoning={streamingReasoning}
      scrollTop={0}
      onMetrics={noMetrics}
      isWaitingForResponse={false}
      responseStartTime={null}
      isCompacting={false}
      compactionStartTime={null}
      isBashToolRunning={false}
    />,
  );

describe("TranscriptContent", () => {
  it("renders reasoning while it is still arriving", () => {
    const { lastFrame, unmount } = renderTranscript([], {
      streamingReasoning: "Looking at the files",
    });

    try {
      const frame = lastFrame() ?? "";
      expect(frame).toContain("Looking at the files");
    } finally {
      unmount();
    }
  });

  it("renders the banner while the conversation is empty", () => {
    const { lastFrame, unmount } = renderTranscript([], {
      showIntroMessage: true,
    });

    try {
      expect(lastFrame() ?? "").toContain("TNT banner");
    } finally {
      unmount();
    }
  });

  it("keeps the banner above the first message", () => {
    const { lastFrame, unmount } = renderTranscript(
      [item("user", "first question")],
      { showIntroMessage: true },
    );

    try {
      const frame = lastFrame() ?? "";
      expect(frame).toContain("TNT banner");
      expect(frame).toContain("first question");
      expect(frame.indexOf("TNT banner")).toBeLessThan(
        frame.indexOf("first question"),
      );
    } finally {
      unmount();
    }
  });

  it("keeps settled messages before the live answer", () => {
    const { lastFrame, unmount } = renderTranscript([
      item("user", "first question"),
      item("assistant", "streaming answer"),
    ]);

    try {
      const frame = lastFrame() ?? "";
      expect(frame.indexOf("first question")).toBeLessThan(
        frame.indexOf("streaming answer"),
      );
    } finally {
      unmount();
    }
  });

  it("renders queued messages after the transcript", () => {
    const { lastFrame, unmount } = renderTranscript(
      [item("assistant", "last answer")],
      { queued: [{ message: "queued follow-up" }] },
    );

    try {
      const frame = lastFrame() ?? "";
      expect(frame.indexOf("last answer")).toBeLessThan(
        frame.indexOf("queued follow-up"),
      );
    } finally {
      unmount();
    }
  });

  it("does not print a terminal-height blank anchor", () => {
    const { lastFrame, unmount } = renderTranscript([], {
      showIntroMessage: true,
    });

    try {
      const lines = (lastFrame() ?? "").split("\n");
      const first = lines.find((line) => line.trim() !== "");
      expect(first).toContain("TNT banner");
    } finally {
      unmount();
    }
  });
});

describe("first-exchange render counts (real renderer)", () => {
  const realItem = (
    role: string,
    content: string,
    reasoning?: string,
  ): ChatHistoryItem =>
    ({
      message: { role, content },
      contextItems: [],
      ...(reasoning ? { reasoning: { text: reasoning } } : {}),
    }) as ChatHistoryItem;

  it("renders the first user message exactly once", () => {
    const history = [
      realItem("user", "hi,您是什么模型?"),
      realItem(
        "assistant",
        "你好！我是运行在 TNT 环境中的 AI 编程助手。有什么可以帮你的吗？",
        "The user greets me and asks what model I am.",
      ),
      realItem("user", "你会写代码吗?"),
      realItem(
        "assistant",
        "会的。我可以帮你:\n\n- 写代码: 用常见语言实现功能",
        "The user is asking whether I can write code.",
      ),
    ];

    const Probe: React.FC = () => {
      const { renderMessage } = useMessageRenderer();
      return (
        <TranscriptContent
          showIntroMessage={false}
          chatHistory={history}
          renderMessage={renderMessage}
          scrollTop={0}
          onMetrics={noMetrics}
          isWaitingForResponse={false}
          responseStartTime={null}
          isCompacting={false}
          compactionStartTime={null}
          isBashToolRunning={false}
        />
      );
    };

    const { lastFrame, unmount } = render(<Probe />);

    try {
      const frame = lastFrame() ?? "";
      const count = frame.split("hi,您是什么模型?").length - 1;
      expect(count).toBe(1);
      const secondCount = frame.split("你会写代码吗?").length - 1;
      expect(secondCount).toBe(1);
    } finally {
      unmount();
    }
  });
});

describe("reasoning blank-line counts", () => {
  const item = (role: string, content: string): ChatHistoryItem =>
    ({ message: { role, content }, contextItems: [] }) as ChatHistoryItem;

  it("keeps the gap between settled content and the streaming thought tight", () => {
    const history = [
      item("user", "你会写代码吗?"),
      item("assistant", "会的。我可以帮你:"),
    ];

    const Probe: React.FC = () => {
      const { renderMessage } = useMessageRenderer();
      return (
        <TranscriptContent
          showIntroMessage={false}
          chatHistory={history}
          renderMessage={renderMessage}
          streamingReasoning="The user is asking whether I can write code. This is a simple conversational question about my capabilities, so no tools are needed yet."
          scrollTop={0}
          onMetrics={noMetrics}
          isWaitingForResponse={true}
          responseStartTime={1000}
          isCompacting={false}
          compactionStartTime={null}
          isBashToolRunning={false}
        />
      );
    };

    const { lastFrame, unmount } = render(<Probe />);

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");
      const contentLine = lines.findIndex((line) =>
        line.includes("我可以帮你"),
      );
      const thoughtLine = lines.findIndex((line) =>
        line.includes("The user is asking"),
      );
      expect(contentLine).toBeGreaterThan(-1);
      expect(thoughtLine).toBeGreaterThan(-1);
      const gap = lines
        .slice(contentLine + 1, thoughtLine)
        .filter((line) => line.trim() === "").length;
      // Record the actual gap so the fix can be judged against evidence.
      expect(gap).toBeLessThanOrEqual(2);
    } finally {
      unmount();
    }
  });
});

describe("attached reasoning gap counts", () => {
  it("keeps the gap between an answer chunk and its attached thought tight", () => {
    const history = [
      { message: { role: "user", content: "你会写代码吗?" }, contextItems: [] },
      {
        message: { role: "assistant", content: "会的。我可以帮你:" },
        contextItems: [],
      },
      {
        message: { role: "assistant", content: "- 写代码: 用常见语言实现功能" },
        contextItems: [],
        reasoning: {
          text: "The user is asking whether I can write code. This is a simple conversational question about my capabilities, so no tools are needed yet.",
        },
      },
    ] as ChatHistoryItem[];

    const Probe: React.FC = () => {
      const { renderMessage } = useMessageRenderer();
      return (
        <TranscriptContent
          showIntroMessage={false}
          chatHistory={history}
          renderMessage={renderMessage}
          scrollTop={0}
          onMetrics={noMetrics}
          isWaitingForResponse={false}
          responseStartTime={null}
          isCompacting={false}
          compactionStartTime={null}
          isBashToolRunning={false}
        />
      );
    };

    const { lastFrame, unmount } = render(<Probe />);

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");
      const contentLine = lines.findIndex((line) =>
        line.includes("我可以帮你"),
      );
      // The round ended, so the block folds to its one-line label, as in the
      // reference CLI; the streamed-open gap is covered by the live test.
      const thoughtLine = lines.findIndex((line) => line.includes("Thinking"));
      expect(contentLine).toBeGreaterThan(-1);
      expect(thoughtLine).toBeGreaterThan(-1);
      const gap = lines
        .slice(contentLine + 1, thoughtLine)
        .filter((line) => line.trim() === "").length;
      expect(gap).toBeLessThanOrEqual(2);
    } finally {
      unmount();
    }
  });
});

describe("tool round gap counts", () => {
  const toolItem = (
    id: string,
    name: string,
    output: string,
  ): ChatHistoryItem =>
    ({
      message: { role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: id,
          status: "done",
          toolCall: { id, function: { name, arguments: "{}" } },
          parsedArgs: {},
          output: [{ content: output }],
        },
      ],
    }) as unknown as ChatHistoryItem;

  it("keeps consecutive tool blocks tight, as in the reference CLI", () => {
    const history = [
      { message: { role: "user", content: "看看文件" }, contextItems: [] },
      {
        message: { role: "assistant", content: "我来查看。" },
        contextItems: [],
      },
      toolItem("t1", "Bash", "file one"),
      toolItem("t2", "Read", "file two"),
    ] as ChatHistoryItem[];

    const Probe: React.FC = () => {
      const { renderMessage } = useMessageRenderer();
      return (
        <TranscriptContent
          showIntroMessage={false}
          chatHistory={history}
          renderMessage={renderMessage}
          scrollTop={0}
          onMetrics={noMetrics}
          isWaitingForResponse={false}
          responseStartTime={null}
          isCompacting={false}
          compactionStartTime={null}
          isBashToolRunning={false}
        />
      );
    };

    const { lastFrame, unmount } = render(<Probe />);

    try {
      const frame = lastFrame() ?? "";
      const lines = frame.split("\n");
      const firstToolLine = lines.findIndex((line) => line.includes("Bash"));
      const secondToolLine = lines.findIndex((line) => line.includes("Read"));
      expect(firstToolLine).toBeGreaterThan(-1);
      expect(secondToolLine).toBeGreaterThan(firstToolLine);
      const gap = lines
        .slice(firstToolLine + 1, secondToolLine)
        .filter((line) => line.trim() === "").length;
      // Consecutive tool blocks sit tight: at most one blank row between them.
      expect(gap).toBeLessThanOrEqual(1);
    } finally {
      unmount();
    }
  });
});
