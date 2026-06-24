import { beforeEach, describe, expect, it, vi } from "vitest";

const handleSlashCommands = vi.hoisted(() => vi.fn());
const addSystemMessage = vi.hoisted(() => vi.fn());
const clear = vi.hoisted(() => vi.fn());
const compact = vi.hoisted(() => vi.fn());
const getState = vi.hoisted(() => vi.fn());

vi.mock("../ui/commands/index.js", () => ({ handleSlashCommands }));
vi.mock("./index.js", () => ({
  services: {
    chatHistory: {
      addSystemMessage,
      clear,
      compact,
      getHistory: () => [],
    },
    model: { getState },
  },
}));

const { applyWebUiSlashCommand } = await import("./webuiSlashMessage.js");

const assistant = { models: [] } as any;

beforeEach(() => {
  handleSlashCommands.mockReset();
  addSystemMessage.mockReset();
  clear.mockReset();
  compact.mockReset();
  getState.mockReturnValue({ model: null, llmApi: null });
});

describe("dispatching a browser message as a command", () => {
  it("passes ordinary text through untouched", async () => {
    const effect = await applyWebUiSlashCommand("fix the parser", assistant);

    expect(effect).toEqual({ kind: "prompt", prompt: "fix the parser" });
    expect(handleSlashCommands).not.toHaveBeenCalled();
  });

  it("sends a slash-typed prompt to the model when no command claims it", async () => {
    handleSlashCommands.mockResolvedValue(null);

    const effect = await applyWebUiSlashCommand(
      "/usr/bin/env is broken",
      assistant,
    );

    expect(effect).toEqual({
      kind: "prompt",
      prompt: "/usr/bin/env is broken",
    });
  });

  it("puts a print command's answer in the transcript, not in the queue", async () => {
    handleSlashCommands.mockResolvedValue({
      output: "Available subagents: dev",
    });

    const effect = await applyWebUiSlashCommand("/subagents", assistant);

    expect(addSystemMessage).toHaveBeenCalledWith("Available subagents: dev");
    expect(effect).toMatchObject({
      kind: "answered",
      payload: { queued: false, output: "Available subagents: dev" },
      sessionChanged: true,
    });
  });

  it("queues the text a prompt source hands over", async () => {
    handleSlashCommands.mockResolvedValue({
      newInput: "Load the skill review",
    });

    const effect = await applyWebUiSlashCommand("/review foo", assistant);

    expect(effect).toEqual({ kind: "prompt", prompt: "Load the skill review" });
  });

  it("clears the history and tells the tabs to reload", async () => {
    handleSlashCommands.mockResolvedValue({ clear: true });

    const effect = await applyWebUiSlashCommand("/clear", assistant);

    expect(clear).toHaveBeenCalledOnce();
    expect(effect).toMatchObject({
      kind: "answered",
      payload: { queued: false, cleared: true },
      sessionChanged: true,
    });
  });

  it("reports a picker command instead of prompting the model with it", async () => {
    handleSlashCommands.mockResolvedValue({ openModelSelector: true });

    const effect = await applyWebUiSlashCommand("/model", assistant);

    expect(effect).toMatchObject({
      kind: "answered",
      payload: { queued: false, unsupported: true },
    });
    if (effect.kind !== "answered") throw new Error("expected an answer");
    expect(effect.notice).toContain("/model");
  });

  it("refuses to compact with no model loaded rather than throwing", async () => {
    handleSlashCommands.mockResolvedValue({ compact: true });

    const effect = await applyWebUiSlashCommand("/compact", assistant);

    expect(compact).not.toHaveBeenCalled();
    expect(effect).toMatchObject({
      kind: "answered",
      payload: { queued: false, compacted: false },
    });
  });

  it("skips the dispatch entirely when no assistant is loaded", async () => {
    const effect = await applyWebUiSlashCommand("/help", null);

    expect(handleSlashCommands).not.toHaveBeenCalled();
    expect(effect).toEqual({ kind: "prompt", prompt: "/help" });
  });
});
