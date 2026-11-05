import { readFileSync } from "node:fs";

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
import { Composer, composerShape } from "./Composer.tsx";
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

  it("keeps the composer a pill while the text fits one line", () => {
    const { container } = render(
      <Composer
        waiting={false}
        onSend={() => {}}
        onStop={() => {}}
        onOpenMenu={() => {}}
      />,
    );
    const input = screen.getByRole("textbox");
    Object.defineProperty(input, "scrollHeight", {
      value: 24,
      configurable: true,
    });
    fireEvent.change(input, { target: { value: "one line" } });
    expect(
      container.querySelector("[data-shape]")?.getAttribute("data-shape"),
    ).toBe("pill");
  });

  it("squares the composer off once the text needs a second line", () => {
    const { container } = render(
      <Composer
        waiting={false}
        onSend={() => {}}
        onStop={() => {}}
        onOpenMenu={() => {}}
      />,
    );
    const input = screen.getByRole("textbox");
    Object.defineProperty(input, "scrollHeight", {
      value: 48,
      configurable: true,
    });
    fireEvent.change(input, { target: { value: "two lines of text" } });
    expect(
      container.querySelector("[data-shape]")?.getAttribute("data-shape"),
    ).toBe("card");
    // The frame stops centring the actions against a taller text block.
    expect(input.parentElement?.getAttribute("data-shape")).toBe("card");
  });

  it("derives the composer shape from the line height alone", () => {
    expect(composerShape(24, 24)).toBe("pill");
    expect(composerShape(23, 24)).toBe("pill");
    expect(composerShape(25, 24)).toBe("card");
    expect(composerShape(120, 24)).toBe("card");
  });

  it("keeps the composer radius on one token standard", () => {
    const theme = readFileSync("src/ui/theme/base.css", "utf8");
    const composer = readFileSync("src/ui/chat/Composer.module.css", "utf8");
    expect(theme).toContain("--dsw-radius-full: 9999px");
    expect(composer).toContain("border-radius: var(--dsw-radius-full)");
    expect(composer).toContain('[data-shape="card"]');
    expect(composer).toContain("border-radius: var(--dsw-radius-xl)");
    expect(composer).not.toMatch(/border-radius:\s*\d/);
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

  it("collapses a finished tool card and expands it on click", () => {
    render(
      <ChatItemView
        item={{ kind: "tool", toolName: "bash", status: "done", result: "out" }}
      />,
    );
    const toggle = screen.getByRole("button", { name: /bash/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = toggle.nextElementSibling as HTMLElement;
    expect(panel.getAttribute("data-open")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("data-open")).toBe("true");
    expect(screen.getAllByText("out").length).toBeGreaterThan(0);
  });

  it("starts a running tool card expanded", () => {
    render(
      <ChatItemView item={{ kind: "tool", toolName: "npm", status: "calling" }} />,
    );
    const toggle = screen.getByRole("button", { name: /npm/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses a tool card when its operation finishes", () => {
    const { rerender } = render(
      <ChatItemView
        item={{ kind: "tool", toolName: "git", status: "calling", result: "ok" }}
      />,
    );
    const toggle = screen.getByRole("button", { name: /git/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    rerender(
      <ChatItemView
        item={{ kind: "tool", toolName: "git", status: "done", result: "ok" }}
      />,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a reader-closed tool card closed when the operation finishes", () => {
    const { rerender } = render(
      <ChatItemView
        item={{ kind: "tool", toolName: "grep", status: "calling", result: "hit" }}
      />,
    );
    const toggle = screen.getByRole("button", { name: /grep/ });
    fireEvent.click(toggle);
    rerender(
      <ChatItemView
        item={{ kind: "tool", toolName: "grep", status: "done", result: "hit" }}
      />,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
