import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendSessionNotice,
  clearSessionNotices,
  getSessionNotices,
  subscribeSessionNotices,
} from "./sessionNotices.js";

describe("session notices", () => {
  afterEach(() => {
    clearSessionNotices();
  });

  it("appends to the transcript and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionNotices(listener);

    appendSessionNotice("  https://127.0.0.1:1234/#token=abc  ");

    expect(getSessionNotices()).toEqual(["https://127.0.0.1:1234/#token=abc"]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores blank text", () => {
    appendSessionNotice("   ");
    expect(getSessionNotices()).toEqual([]);
  });

  it("keeps the newest notices and drops the oldest past the cap", () => {
    for (let index = 0; index < 25; index += 1) {
      appendSessionNotice(`notice ${index}`);
    }
    const notices = getSessionNotices();
    expect(notices).toHaveLength(20);
    expect(notices[0]).toBe("notice 5");
    expect(notices.at(-1)).toBe("notice 24");
  });

  it("clears without notifying when already empty", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionNotices(listener);
    clearSessionNotices();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
