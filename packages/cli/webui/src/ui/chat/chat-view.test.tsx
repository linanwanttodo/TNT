import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/client.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  approve: vi.fn().mockResolvedValue(undefined),
}));

import { useSessionStore } from "../../stores/session-store.js";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ChatItemView } from "./ChatItemView.tsx";
import { ChatView } from "./ChatView.tsx";
import { Composer } from "./Composer.tsx";
import { ReasoningRow } from "./ReasoningRow.tsx";

describe("chat view", () => {
  afterEach(cleanup);

  it("renders a user bubble and an assistant markdown message", () => {
    render(
      <div>
        <ChatItemView item={{ kind: "message", role: "user", text: "hello" }} />
        <ChatItemView item={{ kind: "message", role: "assistant", text: "hi there" }} />
      </div>,
    );
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("hi there")).toBeTruthy();
  });

  it("renders an approval card with allow and reject actions", () => {
    render(
      <ApprovalCard
        pending={{ requestId: "r1", toolName: "bash", toolArgs: { cmd: "ls" } }}
        onAnswer={() => {}}
      />,
    );
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByText("Allow")).toBeTruthy();
    expect(screen.getByText("Reject")).toBeTruthy();
  });

  it("renders the composer with a send button that flips to stop", () => {
    const { rerender } = render(<Composer waiting={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    rerender(<Composer waiting onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("renders a reasoning row collapsed by default", () => {
    render(<ReasoningRow text="why am I doing this" running />);
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getAllByText("why am I doing this").length).toBeGreaterThan(0);
  });

  it("renders a full transcript through ChatView", () => {
    const items = useSessionStore.getState().items;
    render(
      <ChatView
        items={[
          ...items,
          { kind: "message", role: "user", text: "list files" },
          { kind: "tool", toolName: "bash", status: "done", result: "a b c" },
          { kind: "message", role: "assistant", text: "done" },
        ]}
        streaming={null}
        reasoning={null}
        pendingPermission={null}
        notices={[]}
        onAnswer={() => {}}
      />,
    );
    expect(screen.getByText("list files")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });
});
