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

/** A tool result in the shape the Edit/Write tools report. */
const UNIFIED_DIFF = [
  "--- a/src/utils/formatError.ts",
  "+++ b/src/utils/formatError.ts",
  "@@ -12,2 +12,3 @@",
  "-export function formatError(e: unknown): string {",
  "-  return String(e);",
  "+export function formatError(error: unknown): string {",
  "+  return String(error);",
  "+}",
].join("\n");

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

  it("names the file a Read card operated on", () => {
    render(
      <ChatItemView
        item={{
          kind: "tool",
          toolName: "Read",
          status: "done",
          args: { file_path: "/repo/src/a.ts" },
        }}
      />,
    );
    expect(screen.getByText("/repo/src/a.ts")).toBeTruthy();
  });

  it("shows the command a Bash card ran", () => {
    render(
      <ChatItemView
        item={{
          kind: "tool",
          toolName: "Bash",
          status: "done",
          args: { command: "npm test" },
        }}
      />,
    );
    expect(screen.getByText("npm test")).toBeTruthy();
  });

  it("renders a diff result as added and removed rows", () => {
    const { container } = render(
      <ChatItemView
        item={{
          kind: "tool",
          toolName: "Edit",
          status: "done",
          args: { file_path: "/repo/src/utils/formatError.ts" },
          result: UNIFIED_DIFF,
        }}
      />,
    );
    expect(container.querySelector("[data-diff]")).toBeTruthy();
    const texts = (selector: string) =>
      [...container.querySelectorAll(selector)].map((el) => el.textContent);
    expect(texts("[class*=add]")).toContain("  return String(error);");
    expect(texts("[class*=del]")).toContain("  return String(e);");
  });

  it("keeps a malformed diff as text instead of throwing", () => {
    const { container } = render(
      <ChatItemView
        item={{
          kind: "tool",
          toolName: "Edit",
          status: "done",
          // The header promises nine lines per side and carries one, which
          // makes the patch parser throw.
          result: "--- a/x.ts\n+++ b/x.ts\n@@ -1,9 +1,9 @@\n-only one line\n",
        }}
      />,
    );
    expect(container.querySelector("[data-diff]")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain(
      "only one line",
    );
  });

  it("keeps a plain command result as text", () => {
    const { container } = render(
      <ChatItemView
        item={{
          kind: "tool",
          toolName: "Bash",
          status: "done",
          args: { command: "npm test" },
          result: "Test Files  1 passed (1)",
        }}
      />,
    );
    expect(container.querySelector("[data-diff]")).toBeNull();
    // The matcher normalizes runs of spaces, so read the block itself.
    expect(container.querySelector("pre")?.textContent).toContain(
      "Test Files  1 passed (1)",
    );
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
      <Composer waiting={false} onSend={() => {}} onStop={() => {}} />,
    );
    // The reference hides the send button on an empty input; it appears with text.
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    rerender(<Composer waiting onSend={() => {}} onStop={() => {}} />);
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
