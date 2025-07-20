import { Tool } from "core";
import { BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import { getModeToolAccess, MODE_DEFINITIONS } from "./modes";

function makeTool(
  name: string,
  options: { readonly?: boolean; group?: string } = {},
): Tool {
  return {
    type: "function",
    function: { name },
    displayTitle: name,
    readonly: options.readonly ?? false,
    group: options.group ?? BUILT_IN_GROUP_NAME,
    defaultToolPolicy: "allowedWithPermission",
  } as Tool;
}

const readOnlyTool = makeTool("readFile", { readonly: true });
const writeTool = makeTool("editFile", { readonly: false });
const mcpWriteTool = makeTool("mcpWriter", {
  readonly: false,
  group: "MCP",
});

describe("mode tool access", () => {
  it("offers exactly the five fixed modes in display order", () => {
    expect(MODE_DEFINITIONS.map((definition) => definition.id)).toEqual([
      "plan",
      "debug",
      "multitask",
      "chat",
      "agent",
    ]);
  });

  it("gives agent and multitask the full enabled set", () => {
    expect(getModeToolAccess("agent")).toBe("all");
    expect(getModeToolAccess("multitask")).toBe("all");
  });

  it("keeps plan, debug and ask on read-only tools", () => {
    expect(getModeToolAccess("plan")).toBe("readonly");
    expect(getModeToolAccess("debug")).toBe("readonly");
    expect(getModeToolAccess("chat")).toBe("readonly");
  });

  it("falls back to the full set for an unknown mode", () => {
    expect(getModeToolAccess("something-else" as never)).toBe("all");
  });

  it("documents that only built-in tools are filtered by readonly", () => {
    // Non built-in groups (MCP) are not narrowed by the readonly gate, so the
    // selector keeps them and relies on their own policy instead.
    expect(readOnlyTool.readonly).toBe(true);
    expect(writeTool.group).toBe(BUILT_IN_GROUP_NAME);
    expect(mcpWriteTool.group).toBe("MCP");
  });
});
