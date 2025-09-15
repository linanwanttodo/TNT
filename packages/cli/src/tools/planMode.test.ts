import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import {
  getSessionPromptProfile,
  setSessionPromptProfile,
} from "../session/index.js";

import { enterPlanModeTool, exitPlanModeTool } from "./planMode.js";

import { getAllAvailableTools } from "./index.js";

describe("the plan mode tools", () => {
  beforeEach(() => {
    serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
      model: { name: "test-model" },
    } as never);
    serviceContainer.registerValue(SERVICE_NAMES.MCP, {
      connections: [],
      tools: [],
    } as never);
  });

  afterEach(() => {
    setSessionPromptProfile(undefined);
  });

  it("is offered to the model, since a tool nobody can call changes nothing", async () => {
    const names = (await getAllAvailableTools(false, false)).map((t) => t.name);

    expect(names).toContain("EnterPlanMode");
    expect(names).toContain("ExitPlanMode");
  });

  it("enters plan mode when the agent asks for it", async () => {
    const message = await enterPlanModeTool.run({});

    expect(getSessionPromptProfile()).toBe("plan");
    expect(message).toContain("ExitPlanMode");
    expect(message).toContain("Code cannot be modified");
  });

  it("leaves plan mode and clears the profile on the way out", async () => {
    await enterPlanModeTool.run({});
    const message = await exitPlanModeTool.run({});

    expect(getSessionPromptProfile()).toBeUndefined();
    expect(message).toContain("changes are allowed again");
  });

  it("says when to enter, and when the request is already clear", () => {
    const description = enterPlanModeTool.description;

    expect(description).toContain("more than two or three files");
    expect(description).toContain("More than one approach would work");
    expect(description).toContain("a typo");
    expect(description).toContain("Write the plan to a documentation file");
  });

  it("says what the exit tool is not for", () => {
    const description = exitPlanModeTool.description;

    expect(description).toContain("does not carry the plan as an argument");
    expect(description).toContain("nothing to plan");
  });
});
