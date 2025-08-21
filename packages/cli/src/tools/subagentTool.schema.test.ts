import { describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import {
  LIST_SUBAGENTS_TOOL_META,
  SUBAGENT_TOOL_META,
} from "../subagent/index.js";

import { listSubagentsTool, subagentTool } from "./subagent.js";

/**
 * The registry entry and the tool a run is offered are derived from one
 * definition: the builder spreads the entry. The one deliberate difference is
 * the delegation tool's agent-name parameter, whose description points at the
 * listing tool because the listing is a separate call. Anything beyond that
 * would mean the model is shown a different schema than the registry describes.
 */
async function build(): Promise<{
  subagent: Awaited<ReturnType<typeof subagentTool>>;
  list: Awaited<ReturnType<typeof listSubagentsTool>>;
}> {
  serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
    model: { name: "test-model" },
  } as never);
  return { subagent: await subagentTool(), list: await listSubagentsTool() };
}

describe("the delegation tools and their registry entries", () => {
  it("keeps every parameter the entry declares", async () => {
    const { subagent } = await build();

    expect(subagent.parameters.required).toEqual(
      SUBAGENT_TOOL_META.parameters.required,
    );
    expect(Object.keys(subagent.parameters.properties).sort()).toEqual(
      Object.keys(SUBAGENT_TOOL_META.parameters.properties).sort(),
    );
  });

  it("replaces only the agent-name description, and says where to look", async () => {
    const { subagent } = await build();
    const metaDescription =
      SUBAGENT_TOOL_META.parameters.properties.subagent_name.description;
    const liveDescription =
      subagent.parameters.properties.subagent_name.description;

    expect(liveDescription).not.toBe(metaDescription);
    expect(liveDescription).toContain("listing tool");
  });

  it("keeps the other parameter descriptions untouched", async () => {
    const { subagent } = await build();

    for (const key of Object.keys(SUBAGENT_TOOL_META.parameters.properties)) {
      if (key === "subagent_name") continue;
      expect(subagent.parameters.properties[key].description, key).toBe(
        SUBAGENT_TOOL_META.parameters.properties[key].description,
      );
    }
  });

  it("offers the listing tool as its entry describes, with a real run", async () => {
    const { list } = await build();

    // The entry carries a stub run, since the registry is read for names and
    // schemas rather than executed.
    expect(list.run).not.toBe(LIST_SUBAGENTS_TOOL_META.run);
    for (const key of [
      "name",
      "displayName",
      "description",
      "readonly",
      "isBuiltIn",
    ] as const) {
      expect(list[key], key).toEqual(LIST_SUBAGENTS_TOOL_META[key]);
    }
    expect(list.parameters).toEqual(LIST_SUBAGENTS_TOOL_META.parameters);
  });

  it("carries the identity fields from the entry", async () => {
    const { subagent, list } = await build();

    expect(subagent.name).toBe(SUBAGENT_TOOL_META.name);
    expect(subagent.displayName).toBe(SUBAGENT_TOOL_META.displayName);
    expect(list.name).toBe(LIST_SUBAGENTS_TOOL_META.name);
    expect(list.readonly).toBe(true);
  });
});
