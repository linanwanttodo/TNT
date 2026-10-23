import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    configureHeadlessMode: vi.fn(),
    getLogPath: vi.fn(),
    getSessionId: vi.fn(),
  },
}));

import { messageQueue } from "./messageQueue.js";

function drain(): void {
  while (messageQueue.getNextMessage()) {
    // drain the singleton between cases
  }
}

beforeEach(() => {
  drain();
});

describe("messageQueue", () => {
  it("enqueues and emits messageQueued", async () => {
    const event = new Promise<any>((resolve) =>
      messageQueue.once("messageQueued", resolve),
    );

    const ok = await messageQueue.enqueueMessage("hello world");
    expect(ok).toBe(true);
    expect(messageQueue.getQueueLength()).toBe(1);

    const queued = await event;
    expect(queued.id).toMatch(/^queued-\d+$/);
    expect(queued.message).toBe("hello world");
  });

  it("gives every entry a stable id", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");

    const entries = messageQueue.getAllMessages();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    expect(entries.map((entry) => entry.message)).toEqual(["first", "second"]);
  });

  it("emits the dequeued entry so a view removes one row", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");

    const event = new Promise<any>((resolve) =>
      messageQueue.once("messageDequeued", resolve),
    );

    const next = messageQueue.getNextMessage();
    expect(next?.message).toBe("first");
    expect(messageQueue.getQueueLength()).toBe(1);
    expect((await event).id).toBe(next?.id);
  });

  it("removes an entry by id", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");
    const target = messageQueue.getAllMessages()[0];

    expect(messageQueue.removeMessage(target.id)?.message).toBe("first");
    expect(messageQueue.getAllMessages().map((entry) => entry.message)).toEqual(
      ["second"],
    );
    expect(messageQueue.removeMessage("missing")).toBeUndefined();
  });

  it("updates one entry without moving its position", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");
    const target = messageQueue.getAllMessages()[1];

    expect(messageQueue.updateMessage(target.id, "edited")).toBe(true);
    expect(messageQueue.getAllMessages().map((entry) => entry.message)).toEqual(
      ["first", "edited"],
    );
    expect(messageQueue.updateMessage(target.id, "edited")).toBe(false);
  });

  it("clears every waiting entry on reset", async () => {
    await messageQueue.enqueueMessage("first");
    await messageQueue.enqueueMessage("second");

    messageQueue.clearMessages();

    expect(messageQueue.getAllMessages()).toEqual([]);
    expect(messageQueue.getQueueLength()).toBe(0);
  });
});
