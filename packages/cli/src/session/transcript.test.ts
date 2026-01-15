import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { Transcript } from "./transcript.js";

function item(content: string, role: "user" | "assistant" = "user") {
  return {
    message: { role, content },
    contextItems: [],
  } as ChatHistoryItem;
}

describe("Transcript", () => {
  it("assigns stable ids in append order", () => {
    const transcript = new Transcript();
    const first = item("first");
    const second = item("second");

    const a = transcript.append(first);
    const b = transcript.append(second);

    expect(a.id).not.toBe(b.id);
    expect(transcript.getMessageId(first)).toBe(a.id);
    expect(transcript.snapshot()).toEqual([first, second]);
    expect(transcript.entriesSnapshot().map((entry) => entry.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("keeps ids for unchanged items across a replace", () => {
    const transcript = new Transcript();
    const first = item("first");
    const second = item("second");
    transcript.appendBatch([first, second]);
    const ids = transcript.entriesSnapshot().map((entry) => entry.id);

    transcript.replace([first, second], "sync");

    expect(transcript.entriesSnapshot().map((entry) => entry.id)).toEqual(ids);
  });

  it("stages a batch and commits it only when asked", () => {
    const transcript = new Transcript();
    const assistant = item("working", "assistant");

    transcript.stage([assistant]);

    expect(transcript.snapshot()).toEqual([assistant]);
    expect(transcript.snapshot({ includeStaged: false })).toEqual([]);

    transcript.commitStaged();
    expect(transcript.snapshot()).toEqual([assistant]);
    expect(transcript.stagedSnapshot()).toEqual([]);
  });

  it("discards a staged batch without touching committed entries", () => {
    const transcript = new Transcript();
    transcript.append(item("kept"));
    transcript.stage([item("dropped", "assistant")]);

    transcript.discardStaged();

    expect(
      transcript.snapshot().map((message) => message.message.content),
    ).toEqual(["kept"]);
  });

  it("marks a compaction view without deleting message bodies", () => {
    const transcript = new Transcript();
    const items = [item("a"), item("b"), item("c")];
    transcript.appendBatch(items);

    transcript.markCompaction(1);

    expect(transcript.getCompactionIndex()).toBe(1);
    expect(transcript.snapshot()).toEqual(items);
  });

  it("reuses a carried message id on reload", () => {
    const transcript = new Transcript();
    const carried = {
      message: { role: "user", content: "persisted" },
      contextItems: [],
      messageId: "msg-7",
    } as ChatHistoryItem & { messageId: string };

    const entry = transcript.append(carried);
    expect(entry.id).toBe("msg-7");

    const next = transcript.append(item("next"));
    expect(next.id).toBe("msg-8");
  });
});
