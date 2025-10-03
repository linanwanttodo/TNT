import { beforeEach, describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import { generateSubagentToolDescription } from "../subagent/get-agents.js";

import { listFilesTool } from "./listFiles.js";
import { readFileTool } from "./readFile.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { searchCodeTool } from "./searchCode.js";
import { todoTool } from "./todo.js";

import { getAllAvailableTools } from "./index.js";

const bash = runTerminalCommandTool.description;

// Tool descriptions sit in the cached prefix, so this copy must be static text.
describe("tool-level working rules", () => {
  it("sends a file read to Read instead of the shell, including the range", () => {
    expect(bash).toContain("Read a file with Read, not cat, head, tail or sed");
    expect(bash).toContain("start_line/end_line");
    expect(bash).toContain(
      "Edit, MultiEdit or Write, not sed, awk or 'echo >'",
    );
    expect(bash).toContain("not in echo or printf");
  });

  it("splits file lookup from content search, and says where List stops", () => {
    const list = listFilesTool.description;
    const search = searchCodeTool.description;

    // The pair is the mix-up the reference calls out: listing a tree to find a
    // string, or grepping for a file name. List has to say it is one level deep,
    // or a recursive lookup is answered with a single directory.
    expect(list).toContain("one directory");
    expect(list).toContain("does not recurse");
    expect(list).toContain("rg --files");
    expect(search).toContain("content of files, not their names");
  });

  it("states the shell hygiene the reference insists on", () => {
    expect(bash).toContain("quote any path that can contain spaces");
    expect(bash).toContain("'&&', so a failure stops the chain");
    expect(bash).toContain("Never separate commands with a newline");
  });

  it("states the git safety rules", () => {
    expect(bash).toContain("create a new commit rather than '--amend'");
    expect(bash).toContain("amending would rewrite the previous one");
    expect(bash).toContain("git status -uall");
    expect(bash).toContain("only when the user asks for it");
  });

  it("says what comes back from a shell, and what cannot come back", () => {
    expect(bash).toContain(
      "The output returns to you, not reliably to the user",
    );
    expect(bash).toContain("repeated in your answer");
    expect(bash).toContain("There is no terminal to answer a prompt");
  });

  it("keeps a verification read from being spent on an edit that already landed", () => {
    expect(readFileTool.description).toContain(
      "Do not read a file back just to confirm an edit landed",
    );
  });

  it("keeps the todo list honest about progress", () => {
    expect(todoTool.description).toContain("exactly one item in_progress");
    expect(todoTool.description).toContain(
      "not mark an item completed while its test still fails",
    );
    expect(todoTool.description).toContain("three or more steps");
  });

  it("tells the delegating agent to write a real brief", () => {
    const description = generateSubagentToolDescription();

    expect(description).toContain("BRIEF FOR A COLLEAGUE WHO JUST WALKED IN");
    expect(description).toContain("Never delegate understanding");
    expect(description).toContain("do not repeat its search");
    expect(description).toContain("file paths and line numbers");
  });

  describe("on the tools a run is actually offered", () => {
    beforeEach(() => {
      serviceContainer.registerValue(SERVICE_NAMES.MODEL, {
        model: { name: "test-model" },
      } as never);
      serviceContainer.registerValue(SERVICE_NAMES.MCP, {
        connections: [],
        tools: [],
      } as never);
    });

    it("hands the rules over with the tool, not only with the module", async () => {
      const offered = new Map(
        (await getAllAvailableTools(false, false)).map((tool) => [
          tool.name,
          tool.description,
        ]),
      );

      expect(offered.get("Bash")).toBe(bash);
      expect(offered.get("Todo")).toBe(todoTool.description);
    });
  });
});
