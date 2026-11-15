import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messageQueue } from "../../stream/messageQueue.js";
import { getComposerDraft, resetComposerDraft } from "../composerDraft.js";
import { isReasoningExpanded, resetReasoningFold } from "../reasoningFold.js";

import type { Key } from "./useKeypress.js";
import { handleControlKeys } from "./useUserInput.js";

function drainQueue(): void {
  while (messageQueue.getNextMessage()) {
    // drain the singleton between cases
  }
}

function ctrlKey(name: string, ctrl = true): Key {
  return {
    name,
    shift: false,
    alt: false,
    ctrl,
    cmd: false,
    insertable: false,
    sequence: ctrl ? `\x18${name}` : name,
  };
}

beforeEach(() => {
  drainQueue();
});

afterEach(() => {
  drainQueue();
  resetComposerDraft();
  resetReasoningFold();
});

describe("handleControlKeys", () => {
  it("toggles the reasoning fold on Ctrl+O", () => {
    const options = {
      key: ctrlKey("o"),
      exit: vi.fn(),
    };

    expect(isReasoningExpanded()).toBe(false);
    expect(handleControlKeys(options)).toBe(true);
    expect(isReasoningExpanded()).toBe(true);
    expect(handleControlKeys(options)).toBe(true);
    expect(isReasoningExpanded()).toBe(false);
  });

  it("opens the palette on Ctrl+P when the caller has one", () => {
    const onOpenPalette = vi.fn();

    expect(
      handleControlKeys({
        key: ctrlKey("p"),
        exit: vi.fn(),
        onOpenPalette,
      }),
    ).toBe(true);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    // Without a palette the key falls through rather than being swallowed.
    expect(
      handleControlKeys({
        key: ctrlKey("p"),
        exit: vi.fn(),
      }),
    ).toBe(false);
  });

  it("removes the newest queued message on Ctrl+X", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");

    expect(
      handleControlKeys({
        key: ctrlKey("x"),
        exit: vi.fn(),
      }),
    ).toBe(true);

    expect(messageQueue.getAllMessages().map((entry) => entry.message)).toEqual(
      ["first"],
    );
  });

  it("recalls the newest queued message into the composer on Ctrl+R", async () => {
    await messageQueue.enqueueMessage("keep");
    await messageQueue.enqueueMessage("recall me");

    expect(
      handleControlKeys({
        key: ctrlKey("r"),
        exit: vi.fn(),
      }),
    ).toBe(true);

    expect(messageQueue.getAllMessages().map((entry) => entry.message)).toEqual(
      ["keep"],
    );
    expect(getComposerDraft()?.text).toBe("recall me");
  });

  it("leaves the queue shortcuts to a focused popup when disabled", async () => {
    await messageQueue.enqueueMessage("stay");

    expect(
      handleControlKeys({
        key: ctrlKey("x"),
        exit: vi.fn(),
        queueActionsEnabled: false,
      }),
    ).toBe(false);
    expect(messageQueue.getQueueLength()).toBe(1);
  });

  it("leaves an unhandled key to the input buffer", () => {
    expect(
      handleControlKeys({
        key: ctrlKey("o", false),
        exit: vi.fn(),
      }),
    ).toBe(false);
  });
});
