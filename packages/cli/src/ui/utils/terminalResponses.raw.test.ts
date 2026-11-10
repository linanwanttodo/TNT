import { describe, expect, it } from "vitest";

import { TerminalResponseFilter } from "./terminalResponses.js";

describe("raw terminal replies", () => {
  it("drops a raw VTE OSC 11 reply in one read", () => {
    expect(
      new TerminalResponseFilter().consume("\x1b]11;rgb:0000/0000/0000\x1b\\"),
    ).toEqual({ kind: "drop" });
  });
});
