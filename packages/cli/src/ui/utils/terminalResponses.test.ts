import { describe, expect, it } from "vitest";

import {
  bracketedPasteMarker,
  isTerminalResponseSequence,
  TerminalResponseFilter,
} from "./terminalResponses.js";

describe("isTerminalResponseSequence", () => {
  it("matches the exact VTE OSC 11 answer with an ST terminator", () => {
    expect(isTerminalResponseSequence("]11;rgb:0000/0000/0000\\")).toBe(true);
  });

  it("matches BEL-terminated and other OSC colour answers", () => {
    expect(isTerminalResponseSequence("]11;rgb:ffff/ffff/ffff\x07")).toBe(true);
    expect(isTerminalResponseSequence("]10;rgb:1e1e/1e1e/1e1e\\")).toBe(true);
    expect(isTerminalResponseSequence("]4;0;rgb:0000/0000/0000\\")).toBe(true);
  });

  it("matches DCS replies", () => {
    expect(isTerminalResponseSequence("P1$r0m\\")).toBe(true);
    expect(isTerminalResponseSequence("P>|XTerm(370)\\")).toBe(true);
  });

  it("leaves ordinary composer text alone", () => {
    expect(isTerminalResponseSequence("/command")).toBe(false);
    expect(isTerminalResponseSequence("abc")).toBe(false);
    expect(isTerminalResponseSequence("]")).toBe(false);
    expect(isTerminalResponseSequence("[200~")).toBe(false);
    expect(isTerminalResponseSequence("[201~")).toBe(false);
    expect(isTerminalResponseSequence("P")).toBe(false);
  });
});

describe("bracketedPasteMarker", () => {
  it("recognizes both the raw and ESC-stripped marker forms", () => {
    expect(bracketedPasteMarker("\x1b[200~")).toBe("start");
    expect(bracketedPasteMarker("[200~")).toBe("start");
    expect(bracketedPasteMarker("\x1b[201~")).toBe("end");
    expect(bracketedPasteMarker("[201~")).toBe("end");
  });

  it("ignores text that merely looks similar", () => {
    expect(bracketedPasteMarker("[200")).toBeUndefined();
    expect(bracketedPasteMarker("200~")).toBeUndefined();
    expect(bracketedPasteMarker("abc")).toBeUndefined();
  });
});

describe("TerminalResponseFilter", () => {
  it("swallows an OSC 11 reply split at each ESC", () => {
    const filter = new TerminalResponseFilter();

    expect(filter.consume("]").kind).toBe("hold");
    expect(filter.consume("11;rgb:0000/0000/0000").kind).toBe("drop");
    expect(filter.consume("\\").kind).toBe("drop");
    expect(filter.flushHeld()).toBeUndefined();
  });

  it("swallows a BEL-terminated reply", () => {
    const filter = new TerminalResponseFilter();

    expect(filter.consume("]").kind).toBe("hold");
    expect(filter.consume("11;rgb:ffff/ffff/ffff\x07").kind).toBe("drop");
  });

  it("swallows a DCS reply split at each ESC", () => {
    const filter = new TerminalResponseFilter();

    expect(filter.consume("P").kind).toBe("hold");
    expect(filter.consume("1$r0m").kind).toBe("drop");
    expect(filter.consume("\\").kind).toBe("drop");
  });

  it("returns a held prefix when the next event is not a reply", () => {
    const filter = new TerminalResponseFilter();

    expect(filter.consume("]").kind).toBe("hold");
    expect(filter.consume("abc")).toEqual({ kind: "text", flush: "]" });
  });

  it("passes ordinary text through", () => {
    const filter = new TerminalResponseFilter();

    expect(filter.consume("/command")).toEqual({ kind: "text" });
    expect(filter.consume("abc")).toEqual({ kind: "text" });
  });
});
