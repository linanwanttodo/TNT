import { beforeEach, describe, expect, it } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { SERVICE_NAMES } from "../services/types.js";
import { generateSubagentToolDescription } from "../subagent/get-agents.js";

import { applyPatchTool } from "./applyPatch.js";
import { fetchTool } from "./fetch.js";
import { globFilesTool } from "./globFiles.js";
import { listFilesTool } from "./listFiles.js";
import { readFileTool } from "./readFile.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { searchCodeTool } from "./searchCode.js";
import { SKILLS_TOOL_META } from "./skills.js";
import { todoTool } from "./todo.js";
import { writeFileTool } from "./writeFile.js";

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

    // Glob is the third member of the pair: names at depth, so the sentence that
    // sends a lookup to it has to be in its own copy as well.
    expect(globFilesTool.description).toContain("by name pattern at any depth");
    expect(globFilesTool.description).toContain("honours .gitignore");
    expect(globFilesTool.description).toContain("newest");
  });

  it("says what a fetch brings back and what it cannot", () => {
    const fetchCopy = fetchTool.description;

    // The three things worth knowing before the call: the page arrives as
    // markdown, a page built by scripts arrives nearly empty, and an empty
    // answer is about the fetcher, not about the topic.
    expect(fetchCopy).toContain("markdown");
    expect(fetchCopy).toContain("Scripts do not run");
    expect(fetchCopy).toContain("not evidence that the page has nothing");
    expect(fetchCopy).toContain("truncated");
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

  it("sends a change that crosses files to one patch approved once", () => {
    const patch = applyPatchTool.description;

    // The two promises the model cannot infer from a single-file tool: the call
    // covers the whole set, and a half-applicable set writes nothing at all.
    expect(patch).toContain("several files in one step");
    expect(patch).toContain("approved once");
    expect(patch).toContain("nothing is written unless every file");
    expect(patch).toContain("*** Begin Patch");
    expect(patch).toContain("inside the workspace");

    // Write has to hand the multi-file case over, or the model keeps calling it
    // once per file and pays one approval per file.
    expect(writeFileTool.description).toContain("prefer ApplyPatch");
  });

  it("sends a task to its skill before the attempt, not after", () => {
    const skills = SKILLS_TOOL_META.description;

    // Measured against the implementation: the tool only reads the skill file
    // and returns it, so the copy is the sole place that says what to do with
    // it, that an invented name fails, and where the skill's extra files come
    // from (the result's <skill_files>, opened with Read).
    expect(skills).toContain("before starting the task");
    expect(skills).toContain("the procedure to follow");
    expect(skills).toContain("one of the skills listed");
    expect(skills).toContain("does not need reading again");
    expect(skills).toContain("open them with Read");
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
