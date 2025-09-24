import { describe, expect, it, vi } from "vitest";

// The adjacent hand-written mock replaces the builder wholesale, which would
// make this file test the mock instead of the prompt the model reads.
vi.unmock("./systemMessage.js");
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn().mockResolvedValue({ config: { rules: [] } }),
    set: vi.fn(),
  },
}));
vi.mock("../config/hubLoader.js", () => ({
  processRule: vi
    .fn()
    .mockImplementation((spec: string) => Promise.resolve(spec)),
}));

const { constructSystemMessage } = await import("./systemMessage.js");

/**
 * The clauses that decide how an agent works are worth nothing while they live
 * only in a review document: the model has to be told them, where it reads them
 * every turn. Two properties matter - that they are there, and that they are the
 * same bytes every time, because the system message is the cached prefix.
 */
describe("behaviour clauses in the system message", () => {
  it("tells the agent to look before it claims, read before it edits, verify before it reports", async () => {
    const message = await constructSystemMessage("agent", [], undefined);

    expect(message).toContain("# Doing tasks");
    expect(message).toMatch(/Look before you claim/);
    expect(message).toMatch(/not propose a change to code you have not read/);
    expect(message).toMatch(/Verify before you report/);
    expect(message).toMatch(/never state that a suite passed/);
    expect(message).toMatch(
      /An approval given once is not a standing approval/,
    );
    expect(message).toMatch(/Default to writing no comments/);
    expect(message).toContain("# Communication style");
    expect(message).toMatch(/stepped away and is coming back/);
  });

  it("produces the same bytes twice, so the prefix stays cacheable", async () => {
    const first = await constructSystemMessage("agent", [], undefined);
    const second = await constructSystemMessage("agent", [], undefined);

    expect(first).toBe(second);
  });

  it("tells the agent when to act, how far the scope reaches, and what a denial means", async () => {
    const message = await constructSystemMessage("agent", [], undefined);

    expect(message).toMatch(/When you have enough information to act, act/);
    expect(message).toMatch(/The requested scope is the deliverable/);
    expect(message).toMatch(/say exactly what you left out and why/);
    expect(message).toMatch(/denied was declined, not misheard/);
    expect(message).toMatch(/Independent tool calls can be sent together/);
    expect(message).toMatch(
      /Before deleting or overwriting, look at the target/,
    );
    expect(message).toMatch(/cached or indexed after deletion/);
    expect(message).toMatch(/that is their decision: proceed with the whole/);
    expect(message).toMatch(/read your own last paragraph/);
    expect(message).toMatch(/the cause may be somewhere else/);
  });

  it("says how the answer reads, down to the punctuation", async () => {
    const message = await constructSystemMessage("agent", [], undefined);

    expect(message).toMatch(/Lead with the answer or the outcome/);
    expect(message).toMatch(/No em dashes, no arrows/);
    expect(message).toMatch(/Keep code and numbers out of prose/);
    expect(message).toMatch(/Reference a location as path:line/);
    expect(message).toMatch(/no restating what the user can already see/);
  });

  it("tells a headless run to proceed, and says nothing of the sort interactively", async () => {
    const headless = await constructSystemMessage("agent", [], undefined, true);
    const interactive = await constructSystemMessage("agent", [], undefined);

    expect(headless).toMatch(/no question can be answered mid-task/);
    expect(headless).toMatch(/stop only for destructive actions/);
    // A terminal user is watching, so that permission is not given there.
    expect(interactive).not.toMatch(/no question can be answered mid-task/);
  });

  it("puts the clauses ahead of the environment block", async () => {
    const message = await constructSystemMessage("agent", [], undefined);

    expect(message.indexOf("# Doing tasks")).toBeLessThan(
      message.indexOf("<env>"),
    );
  });
});
