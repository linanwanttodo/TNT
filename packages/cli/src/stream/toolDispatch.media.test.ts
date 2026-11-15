import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/index.js", () => ({
  services: {
    chatHistory: {
      addToolResult: vi.fn(),
      addUserMessage: vi.fn(),
    },
  },
}));

vi.mock("../hooks/fireHook.js", () => ({
  firePostToolUse: vi.fn(async () => ({ blocked: false })),
  firePostToolUseFailure: vi.fn(async () => ({ blocked: false })),
}));

vi.mock("../tools/index.js", () => ({
  executeToolCall: vi.fn(),
}));

import { services } from "../services/index.js";
import { executeToolCall } from "../tools/index.js";

import { dispatchApprovedCall } from "./toolDispatch.js";

const execute = vi.mocked(executeToolCall);
const addToolResult = vi.mocked(services.chatHistory.addToolResult);
const addUserMessage = vi.mocked(services.chatHistory.addUserMessage);

function approvedCall(name = "Computer") {
  return {
    id: "call-1",
    name,
    arguments: {},
    argumentsStr: "{}",
    startNotified: false,
    tool: { name, run: async () => "" },
  } as any;
}

async function dispatch(name = "Computer") {
  const call = approvedCall(name);
  const entriesByIndex = new Map();
  await dispatchApprovedCall({
    index: 0,
    call,
    effectiveCall: call,
    plannedKeys: [],
    parallelCount: 1,
    preHook: { blocked: false } as any,
    entriesByIndex,
  });
  return entriesByIndex.get(0);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatch of an image-bearing tool result", () => {
  it("publishes the text as the result and the image as an observation", async () => {
    execute.mockResolvedValue({
      content: "Captured the desktop.",
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    });

    const entry = await dispatch();

    expect(entry.content).toBe("Captured the desktop.");
    expect(addToolResult).toHaveBeenCalledWith(
      "call-1",
      "Captured the desktop.",
      "done",
    );
    expect(addUserMessage).toHaveBeenCalledTimes(1);

    const content = addUserMessage.mock.calls[0][0] as any[];
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1]).toEqual({
      type: "imageUrl",
      imageUrl: { url: "data:image/png;base64,aGVsbG8=" },
    });
  });

  it("adds no observation for a text-only result", async () => {
    execute.mockResolvedValue("plain answer");

    const entry = await dispatch("Read");

    expect(entry.content).toBe("plain answer");
    expect(addUserMessage).not.toHaveBeenCalled();
  });

  it("reports a failure without an observation when the result is malformed", async () => {
    execute.mockResolvedValue({ images: [{}] } as any);

    const entry = await dispatch();

    expect(entry.status).toBe("errored");
    expect(entry.content).toContain("string content");
    expect(addUserMessage).not.toHaveBeenCalled();
  });
});
