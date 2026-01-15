import { render } from "ink-testing-library";
import React from "react";
import { vi } from "vitest";

import type {
  ToolCallState,
  ChatHistoryItem,
} from "../../../../../core/index.js";

import { ToolPermissionSelector } from "./ToolPermissionSelector.js";

// Every rendered tree subscribes to the shared service container, so a test
// that leaves it mounted keeps those handlers alive for the rest of the run.
const mounted: { unmount: () => void }[] = [];

function track(ui: React.ReactElement): ReturnType<typeof render> {
  const tree = render(ui);
  mounted.push(tree);
  return tree;
}

describe("TUIChat - Tool Permission Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const tree of mounted) tree.unmount();
    mounted.length = 0;
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("shows ToolPermissionSelector with correct content", async () => {
    const handleResponse = vi.fn();

    const { lastFrame } = track(
      <ToolPermissionSelector
        toolName="Edit"
        toolArgs={{
          file_path: "/path/to/test.txt",
          old_string: "old content",
          new_string: "new content",
        }}
        requestId="test-request-123"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame();

    // Verify ToolPermissionSelector is shown
    expect(frame).toContain("Edit");
    expect(frame).toContain("Allow this tool call?");
    expect(frame).toContain("1. Allow once");
    expect(frame).toContain("2. Allow for this session");
    expect(frame).toContain("3. Always allow (save a permission rule)");
    expect(frame).toContain("4. No, and tell it what to do instead");
    expect(frame).toContain("(enter)");
    expect(frame).toContain("(s)");
    expect(frame).toContain("(shift+tab)");
    expect(frame).toContain("(esc)");
    // Verify old Cancel option is not shown
    expect(frame).not.toContain("Cancel");
  });

  it("handles keyboard shortcuts for permission approval and rejection", async () => {
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Write"
        toolArgs={{
          file_path: "/path/to/new-file.txt",
          content: "Hello, world!",
        }}
        requestId="test-request-123"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Test Tab key for approval
    stdin.write("\t");

    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-123",
      true,
      false,
      false,
    );
  });

  it("handles escape key for rejection", async () => {
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Bash"
        toolArgs={{
          command: "rm -rf /",
        }}
        requestId="test-request-456"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Test escape key for rejection
    stdin.write("\x1b"); // ESC key

    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-456",
      false,
      false,
      true,
    );
  });

  it("handles 'n' key for rejection", async () => {
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Delete"
        toolArgs={{
          path: "/important/file.txt",
        }}
        requestId="test-request-789"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Test 'n' key for rejection
    stdin.write("n");

    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-789",
      false,
      false,
      true,
    );
  });

  it("handles arrow key navigation in permission selector", async () => {
    const handleResponse = vi.fn();

    const { lastFrame, stdin } = track(
      <ToolPermissionSelector
        toolName="Read"
        toolArgs={{
          file_path: "/path/to/secret.txt",
        }}
        requestId="test-request-123"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Initial state should show the first row selected
    const frame = lastFrame();
    expect(frame).toMatch(/❯ 1\. Allow once/);

    // Test that pressing Enter on default selection triggers approval
    stdin.write("\r");
    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-123",
      true,
      undefined,
      undefined,
      undefined,
    );
  });

  it("offers an approval that is held for the session only", async () => {
    const handleResponse = vi.fn();

    const { lastFrame, stdin } = track(
      <ToolPermissionSelector
        toolName="Bash"
        toolArgs={{ command: "npm run build" }}
        requestId="test-request-session"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Between "allow once" and "always allow" (which writes a rule)
    expect(lastFrame()).toMatch(/Allow for this session/);

    stdin.write("s");
    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-session",
      true,
      false,
      false,
      true,
    );
  });

  it("handles shift+tab key for policy creation", async () => {
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Bash"
        toolArgs={{
          command: "ls -la",
        }}
        requestId="test-request-policy"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Test shift+tab key for approval with policy creation
    // In terminal, shift+tab is typically represented as "\x1b[Z"
    stdin.write("\x1b[Z");

    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-policy",
      true,
      true,
      false,
    );
  });

  it("shows every choice with a distinguishable label", async () => {
    const handleResponse = vi.fn();

    const { lastFrame } = track(
      <ToolPermissionSelector
        toolName="Edit"
        toolArgs={{
          file_path: "/path/to/test.txt",
          old_string: "old content",
          new_string: "new content",
        }}
        requestId="test-request-stop"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame();
    expect(frame).toContain("Allow once");
    expect(frame).toContain("Allow for this session");
    expect(frame).toContain("Always allow (save a permission rule)");
    expect(frame).toContain("No, and tell it what to do instead");
    // Verify old Cancel option is not shown
    expect(frame).not.toContain("Cancel");
  });

  it("picks a choice by its number", async () => {
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Bash"
        toolArgs={{ command: "ls -la" }}
        requestId="test-request-number"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    stdin.write("3");
    await vi.advanceTimersByTimeAsync(50);

    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-number",
      true,
      true,
      undefined,
      undefined,
    );
  });

  it("triggers stop stream when escape key is pressed", async () => {
    // This test ensures the actual ToolPermissionSelector component correctly handles the escape key
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Edit"
        toolArgs={{
          file_path: "/path/to/test.txt",
          old_string: "old content",
          new_string: "new content",
        }}
        requestId="test-request-escape"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Press escape key to trigger the "No, and tell Continue what to do differently" option
    stdin.write("\x1b"); // ESC key

    await vi.advanceTimersByTimeAsync(50);

    // Verify the escape key triggers the stopStream behavior
    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-escape",
      false, // approved = false (rejection)
      false, // createPolicy = false
      true, // stopStream = true (this is the new behavior)
    );
  });

  it("triggers stop stream when 'n' key is pressed", async () => {
    // This test ensures the 'n' key also triggers the new stop stream behavior
    const handleResponse = vi.fn();

    const { stdin } = track(
      <ToolPermissionSelector
        toolName="Write"
        toolArgs={{
          file_path: "/path/to/new-file.txt",
          content: "New content",
        }}
        requestId="test-request-n-key"
        onResponse={handleResponse}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    // Press 'n' key to trigger the "No, and tell Continue what to do differently" option
    stdin.write("n");

    await vi.advanceTimersByTimeAsync(50);

    // Verify the 'n' key triggers the stopStream behavior
    expect(handleResponse).toHaveBeenCalledWith(
      "test-request-n-key",
      false, // approved = false (rejection)
      false, // createPolicy = false
      true, // stopStream = true (this is the new behavior)
    );
  });

  it("shows tool result with red dot and 'Cancelled by user' message", async () => {
    // Import the components we need for this test
    const { ToolResultSummary } = await import("../ToolResultSummary.js");
    const { MemoizedMessage } = await import("./MemoizedMessage.js");

    // Test the ToolResultSummary component directly
    const { lastFrame: summaryFrame } = track(
      <ToolResultSummary toolName="Edit" content="Permission denied by user" />,
    );

    const summary = summaryFrame();
    expect(summary).toContain("Cancelled by user");

    // Test the MemoizedMessage component with a proper tool result in ChatHistoryItem
    const toolCallState: ToolCallState = {
      toolCallId: "test-tool-call",
      toolCall: {
        id: "test-tool-call",
        type: "function",
        function: {
          name: "Edit",
          arguments: JSON.stringify({ file_path: "test.txt" }),
        },
      },
      status: "errored", // Set to errored to show red dot
      parsedArgs: { file_path: "test.txt" },
      output: [
        {
          name: "tool_result",
          content: "Permission denied by user",
          description: "Tool execution denied",
        },
      ],
    };

    const historyItem: ChatHistoryItem = {
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "test-tool-call",
            function: {
              name: "Edit",
              arguments: JSON.stringify({ file_path: "test.txt" }),
            },
            type: "function",
          },
        ],
      },
      contextItems: [],
      toolCallStates: [toolCallState],
    };

    const { lastFrame: messageFrame } = track(
      <MemoizedMessage item={historyItem} index={0} />,
    );

    await vi.advanceTimersByTimeAsync(100);

    const messageOutput = messageFrame();

    // Verify the failed-status marker appears (the same compact glyph the
    // tool group uses for a failed call).
    expect(messageOutput).toContain("x");

    // Verify the tool name appears
    expect(messageOutput).toContain("Edit");
    expect(messageOutput).toContain("Permission denied by user");

    // The MemoizedMessage component correctly identifies this as a failure
    // because the tool result includes "Permission denied"
    // This causes the failure marker to be shown
  });
});
