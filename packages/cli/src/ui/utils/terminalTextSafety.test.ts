import { describe, expect, it } from "vitest";

import { sanitizeTerminalText } from "./terminalTextSafety.js";

const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;

describe("sanitizeTerminalText", () => {
  it("keeps SGR colour, which is how tool output arrives coloured", () => {
    const red = `${ESC}[31mfailed${ESC}[39m`;
    expect(sanitizeTerminalText(`a ${red} b`)).toBe(`a ${red} b`);
  });

  it("keeps private-parameter SGR such as style resets", () => {
    const text = `${ESC}[1;38;5;208mwarn${ESC}[0m`;
    expect(sanitizeTerminalText(text)).toBe(text);
  });

  it("keeps layout whitespace", () => {
    expect(sanitizeTerminalText("a\nb\tc")).toBe("a\nb\tc");
  });

  it("drops an OSC title change without leaking its payload", () => {
    expect(sanitizeTerminalText(`ok ${ESC}]0;pwned${BEL}done`)).toBe("ok done");
  });

  it("drops an OSC terminated by ST", () => {
    expect(sanitizeTerminalText(`a${ESC}]52;c;AAAA${ST}b`)).toBe("ab");
  });

  it("drops a hyperlink OSC rather than rendering a foreign target", () => {
    // The link opens with an OSC, the label is the `x`, and the trailing ST
    // is control, not text.
    expect(sanitizeTerminalText(`${ESC}]8;id=1;https://evil${ST}x${ST}`)).toBe(
      "x",
    );
  });

  it("drops the rest of an unterminated OSC", () => {
    // No terminator means there is no way to tell where the sequence ends, and
    // printing the parameters as text is the leak this avoids.
    expect(sanitizeTerminalText(`a${ESC}]0;pwned`)).toBe("a");
  });

  it("drops non-SGR CSI sequences", () => {
    expect(sanitizeTerminalText(`a${ESC}[?1049hb`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}[2Jb`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}[6nb`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}[?2004hb`)).toBe("ab");
  });

  it("drops device control and application strings", () => {
    expect(sanitizeTerminalText(`a${ESC}P0;1|ZZZ${ST}b`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}_g123${ST}b`)).toBe("ab");
  });

  it("drops two-character escapes that reset or move the cursor", () => {
    expect(sanitizeTerminalText(`a${ESC}cb`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}7b`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}8b`)).toBe("ab");
  });

  it("keeps the text that follows a keypad-mode switch", () => {
    expect(sanitizeTerminalText(`a${ESC}=b`)).toBe("ab");
    expect(sanitizeTerminalText(`a${ESC}>b`)).toBe("ab");
  });

  it("drops other control characters", () => {
    expect(sanitizeTerminalText(`a${ESC}[31m\u0000b\u0008c\u007fd`)).toBe(
      `a${ESC}[31mbcd`,
    );
  });

  it("leaves plain text untouched", () => {
    const text = "npm test\n  ✓ 12 passed — 中文 also survives";
    expect(sanitizeTerminalText(text)).toBe(text);
  });

  it("is idempotent, so a value can pass through more than one layer", () => {
    const hostile = `a${ESC}]0;x${BEL}${ESC}[31mb${ESC}[?1049hc`;
    const once = sanitizeTerminalText(hostile);
    expect(sanitizeTerminalText(once)).toBe(once);
  });

  it("drops a lone escape at the end", () => {
    expect(sanitizeTerminalText(`abc${ESC}`)).toBe("abc");
  });
});
