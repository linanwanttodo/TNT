import { describe, expect, it, vi } from "vitest";

import {
  appendSessionNotice,
  clearSessionNotices,
  getSessionNotices,
  noticesByHistoryIndex,
  subscribeSessionNotices,
} from "./sessionNotices.js";

describe("terminal-only session notices", () => {
  it("anchors each row to the message count at command time", () => {
    clearSessionNotices();
    appendSessionNotice("  /webui answer  ", 2);
    appendSessionNotice("/status answer", 2);

    expect(getSessionNotices()).toEqual([
      { id: expect.any(Number), text: "/webui answer", historyLength: 2 },
      { id: expect.any(Number), text: "/status answer", historyLength: 2 },
    ]);
    clearSessionNotices();
  });

  it("groups rows by their anchor and clamps stale anchors to the tail", () => {
    const rows = [
      { id: 1, text: "a", historyLength: 0 },
      { id: 2, text: "b", historyLength: 2 },
      { id: 3, text: "c", historyLength: 9 },
    ];
    const grouped = noticesByHistoryIndex(rows, 3);

    expect(grouped.get(0)?.map((row) => row.id)).toEqual([1]);
    expect(grouped.get(2)?.map((row) => row.id)).toEqual([2]);
    expect(grouped.get(3)?.map((row) => row.id)).toEqual([3]);
  });

  it("keeps the newest rows under the cap", () => {
    clearSessionNotices();
    for (let i = 0; i < 24; i++) appendSessionNotice(`row ${i}`, i);

    const rows = getSessionNotices();
    expect(rows).toHaveLength(20);
    expect(rows[0].text).toBe("row 4");
    expect(rows.at(-1)?.text).toBe("row 23");
    clearSessionNotices();
  });

  it("notifies subscribers only on a real change", () => {
    clearSessionNotices();
    const listener = vi.fn();
    const unsubscribe = subscribeSessionNotices(listener);

    appendSessionNotice("answer", 0);
    appendSessionNotice("   ", 0);
    expect(listener).toHaveBeenCalledTimes(1);

    clearSessionNotices();
    expect(listener).toHaveBeenCalledTimes(2);

    clearSessionNotices();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    appendSessionNotice("after unsubscribe", 0);
    expect(listener).toHaveBeenCalledTimes(2);
    clearSessionNotices();
  });
});
