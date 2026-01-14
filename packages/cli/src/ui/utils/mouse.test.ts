import { describe, expect, it } from "vitest";

import {
  drainMouseEvents,
  isIncompleteMouseSequence,
  isJumpHintClick,
  isTerminalMouseSequence,
  parseSgrMouseEvent,
} from "./mouse.js";

const click = (col: number, row: number) => `\x1b[<0;${col};${row}M`;

describe("terminal mouse parsing", () => {
  it("recognises the reports Ink would otherwise type into the prompt", () => {
    expect(isTerminalMouseSequence("[<64;10;10M")).toBe(true);
    expect(isTerminalMouseSequence("[<0;1;2m")).toBe(true);
    expect(isTerminalMouseSequence("hello")).toBe(false);
    expect(isTerminalMouseSequence("[tag]")).toBe(false);
  });

  it("parses presses, releases and wheel events", () => {
    expect(parseSgrMouseEvent(click(12, 5))?.event).toMatchObject({
      name: "left-press",
      col: 12,
      row: 5,
    });
    expect(parseSgrMouseEvent("\x1b[<0;3;4m")?.event?.name).toBe(
      "left-release",
    );
    expect(parseSgrMouseEvent("\x1b[<64;3;4M")?.event?.name).toBe("scroll-up");
    expect(parseSgrMouseEvent("\x1b[<65;3;4M")?.event?.name).toBe(
      "scroll-down",
    );
  });

  it("waits for the rest of a split sequence", () => {
    expect(isIncompleteMouseSequence("\x1b[<0;12")).toBe(true);
    expect(parseSgrMouseEvent("\x1b[<0;12")).toBeNull();
    expect(isIncompleteMouseSequence("\x1b")).toBe(true);
    expect(isIncompleteMouseSequence("a")).toBe(false);
  });

  it("drains every complete event and keeps the tail", () => {
    const { events, rest } = drainMouseEvents(
      `${click(2, 3)}\x1b[<64;4;5M\x1b[<0;6`,
    );
    expect(events.map((event) => event.name)).toEqual([
      "left-press",
      "scroll-up",
    ]);
    expect(rest).toBe("\x1b[<0;6");
  });

  it("discards garbage without wedging the parser", () => {
    const { events } = drainMouseEvents(`xyz${click(1, 1)}`);
    expect(events).toHaveLength(1);
  });

  it("maps the hint to the dock's first row only", () => {
    // 30 terminal rows, dock of 7: the hint is row 24 (1-based).
    expect(
      isJumpHintClick(
        {
          name: "left-press",
          col: 1,
          row: 24,
          ctrl: false,
          meta: false,
          shift: false,
        },
        30,
        7,
      ),
    ).toBe(true);
    expect(
      isJumpHintClick(
        {
          name: "left-press",
          col: 1,
          row: 23,
          ctrl: false,
          meta: false,
          shift: false,
        },
        30,
        7,
      ),
    ).toBe(false);
    expect(
      isJumpHintClick(
        {
          name: "left-press",
          col: 1,
          row: 1,
          ctrl: false,
          meta: false,
          shift: false,
        },
        30,
        0,
      ),
    ).toBe(false);
  });
});
