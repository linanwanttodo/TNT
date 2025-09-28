import type { ToolCallState } from "core/index.js";
import { describe, expect, it } from "vitest";

import { toolStateSignature } from "./MemoizedMessage.js";

function state(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolCallId: "call-1",
    toolCall: {
      id: "call-1",
      type: "function",
      function: { name: "Bash", arguments: '{"command":"ls"}' },
    },
    status: "generated",
    parsedArgs: { command: "ls" },
    ...overrides,
  } as ToolCallState;
}

describe("the tool state signature behind the message memo", () => {
  it("says nothing changed for the same state", () => {
    expect(toolStateSignature([state()])).toBe(toolStateSignature([state()]));
  });

  it("notices the status a running tool moves through", () => {
    const before = toolStateSignature([state()]);
    const after = toolStateSignature([state({ status: "done" })]);

    expect(before).not.toBe(after);
  });

  it("notices arguments that arrive in pieces", () => {
    const partial = toolStateSignature([state({ parsedArgs: {} })]);
    const whole = toolStateSignature([
      state({ parsedArgs: { command: "ls" } }),
    ]);

    expect(partial).not.toBe(whole);
  });

  it("notices a result arriving without reading the result", () => {
    const before = toolStateSignature([state()]);
    const secret = "the finished message from the tool";
    const after = toolStateSignature([
      state({
        status: "done",
        output: [
          {
            id: "o1",
            name: "Tool Result",
            description: "",
            content: secret,
          } as never,
        ],
      }),
    ]);

    expect(before).not.toBe(after);
    // The text itself must stay out of the signature: it is the one field nobody
    // can bound, and this comparison runs on every frame of a streamed turn.
    expect(after).not.toContain("finished message");
  });

  it("costs the same for a huge result as for a small one", () => {
    const small = toolStateSignature([
      state({ output: [{ content: "a" } as never] }),
    ]);
    const huge = toolStateSignature([
      state({ output: [{ content: "x".repeat(2_000_000) } as never] }),
    ]);

    expect(small.length).toBeLessThan(200);
    expect(huge).not.toContain("xxxxxx");
  });
});
