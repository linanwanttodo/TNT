import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messageQueue } from "../../stream/messageQueue.js";
import { getComposerDraft, resetComposerDraft } from "../composerDraft.js";
import { isReasoningExpanded, resetReasoningFold } from "../reasoningFold.js";

import { handleControlKeys } from "./useUserInput.js";

function drainQueue(): void {
  while (messageQueue.getNextMessage()) {
    // drain the singleton between cases
  }
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
      input: "o",
      key: { ctrl: true },
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
        input: "p",
        key: { ctrl: true },
        exit: vi.fn(),
        onOpenPalette,
      }),
    ).toBe(true);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    // Without a palette the key falls through rather than being swallowed.
    expect(
      handleControlKeys({
        input: "p",
        key: { ctrl: true },
        exit: vi.fn(),
      }),
    ).toBe(false);
  });

  it("removes the newest queued message on Ctrl+X", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");

    expect(
      handleControlKeys({
        input: "x",
        key: { ctrl: true },
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
        input: "r",
        key: { ctrl: true },
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
        input: "x",
        key: { ctrl: true },
        exit: vi.fn(),
        queueActionsEnabled: false,
      }),
    ).toBe(false);
    expect(messageQueue.getQueueLength()).toBe(1);
  });

  it("leaves an unhandled key to the input buffer", () => {
    expect(
      handleControlKeys({
        input: "o",
        key: { ctrl: false },
        exit: vi.fn(),
      }),
    ).toBe(false);
  });
});
