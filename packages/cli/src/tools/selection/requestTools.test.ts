import { beforeEach, describe, expect, test } from "vitest";

import { writeMinimalConfig } from "../../../test-utils/minimalConfig.js";
import {
  SERVICE_NAMES,
  initializeServices,
  serviceContainer,
} from "../../services/index.js";
import { preprocessStreamedToolCalls } from "../../stream/toolExecution.js";

import { getRequestTools } from "./requestTools.js";

describe("the request's deferred catalog", () => {
  beforeEach(async () => {
    writeMinimalConfig();

    Object.values(SERVICE_NAMES).forEach((service) => {
      (serviceContainer as any).services.delete(service);
      (serviceContainer as any).factories.delete(service);
      (serviceContainer as any).dependencies.delete(service);
    });

    await initializeServices({
      headless: false,
      toolPermissionOverrides: { mode: "default" },
    });
  });

  test("hides a situational built-in behind a catalog that names it", async () => {
    const tools = await getRequestTools(false);
    const names = tools.map((tool) => tool.function.name);

    expect(names).not.toContain("Computer");
    expect(names).not.toContain("WebSearch");
    expect(names).toContain("Read");
    expect(names).toContain("Edit");

    const catalog = tools.find((tool) => tool.function.name === "ToolSearch");
    expect(catalog).toBeDefined();
    expect(catalog?.function.description).toContain("Deferred tools");
    expect(catalog?.function.description).toContain("Computer");
    expect(catalog?.function.description).toContain("WebSearch");
  });

  test("keeps a withheld tool executable once its name is known", async () => {
    const { preprocessedCalls, errorChatEntries } =
      await preprocessStreamedToolCalls(false, [
        {
          id: "call_hidden",
          name: "Computer",
          arguments: { action: "wait", ms: 0 },
          argumentsStr: '{"action":"wait","ms":0}',
          startNotified: false,
        },
      ]);

    expect(errorChatEntries).toEqual([]);
    expect(preprocessedCalls).toHaveLength(1);
    expect(preprocessedCalls[0].name).toBe("Computer");
  });
});
