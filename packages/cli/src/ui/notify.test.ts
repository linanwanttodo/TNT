import { describe, expect, it } from "vitest";

import {
  NOTIFY_MIN_MS,
  notifyMode,
  notifySequence,
  notifyTurnComplete,
} from "./notify.js";

describe("the terminal notification", () => {
  it("is off unless a mode is asked for", () => {
    expect(notifyMode({})).toBe("off");
    expect(notifyMode({ TNT_NOTIFY: "yes" })).toBe("off");
    expect(notifyMode({ TNT_NOTIFY: "bell" })).toBe("bell");
    expect(notifyMode({ TNT_NOTIFY: "1" })).toBe("osc9");
    expect(notifyMode({ TNT_NOTIFY: "OSC9" })).toBe("osc9");
  });

  it("uses the sequence each mode names", () => {
    expect(notifySequence("off", "x")).toBeUndefined();
    expect(notifySequence("bell", "x")).toBe("\u0007");
    expect(notifySequence("osc9", "done")).toBe("\u001B]9;done\u0007");
  });

  it("stays quiet for a turn short enough that nobody looked away", () => {
    const written: string[] = [];
    const sent = notifyTurnComplete({
      mode: "osc9",
      elapsedMs: NOTIFY_MIN_MS - 1,
      text: "done",
      write: (value) => written.push(value),
    });

    expect(sent).toBe(false);
    expect(written).toEqual([]);
  });

  it("writes once for a long turn", () => {
    const written: string[] = [];
    const sent = notifyTurnComplete({
      mode: "osc9",
      elapsedMs: NOTIFY_MIN_MS,
      text: "done",
      write: (value) => written.push(value),
    });

    expect(sent).toBe(true);
    expect(written).toEqual(["\u001B]9;done\u0007"]);
  });
});
