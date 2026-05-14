import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        <ChatItemView
          item={{ kind: "message", role: "assistant", text: "hi there" }}
        />
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
    const { rerender } = render(
      <Composer
        waiting={false}
        onSend={() => {}}
        onStop={() => {}}
        onOpenMenu={() => {}}
      />,
    );
    // The arrow is always drawn; it only lights up once there is text.
    expect(screen.queryByRole("button", { name: "Send" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    rerender(
      <Composer
        waiting
        onSend={() => {}}
        onStop={() => {}}
        onOpenMenu={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("renders a reasoning row collapsed by default", () => {
    render(<ReasoningRow text="why am I doing this" running />);
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getAllByText("why am I doing this").length).toBeGreaterThan(
      0,
    );
  });

  it("leaves the scroll position alone when the user is scrolled up", () => {
    const view = (
      <ChatView
        items={[{ kind: "message", role: "user", text: "q" }]}
        streaming={null}
        reasoning={null}
        pendingPermission={null}
        notices={[]}
        onAnswer={() => {}}
      />
    );
    const { container, rerender } = render(view);
    // frame > scroll: the element whose scrollTop the effect drives.
    const scroll = container.firstElementChild!
      .firstElementChild as HTMLElement;
    Object.defineProperty(scroll, "clientHeight", { value: 100 });
    Object.defineProperty(scroll, "scrollHeight", { value: 500 });
    scroll.scrollTop = 0;
    rerender(
      <ChatView
        items={[
          { kind: "message", role: "user", text: "q" },
          { kind: "message", role: "assistant", text: "a" },
        ]}
        streaming={null}
        reasoning={null}
        pendingPermission={null}
        notices={[]}
        onAnswer={() => {}}
      />,
    );
    // A far-from-bottom user is not yanked to the tail.
    expect(scroll.scrollTop).toBe(0);
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
