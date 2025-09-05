import { ContinueError } from "core/util/errors.js";

import { describe, expect, it } from "vitest";

import { multiEditTool } from "./multiEdit.js";
import { readFileTool } from "./readFile.js";
import { Tool } from "./types.js";
import {
  describeExpectedArgs,
  findArgIssues,
  validateToolCallArgs,
} from "./validateArgs.js";

const tool = (parameters: Tool["parameters"]): Tool => ({
  name: "Demo",
  displayName: "Demo",
  description: "a tool used only by these assertions",
  parameters,
  isBuiltIn: true,
  run: async () => "ok",
});

const call = (name: string, args: any) => ({
  id: "call_1",
  name,
  arguments: args,
  argumentsStr: JSON.stringify(args),
  startNotified: false,
});

describe("validateToolCallArgs", () => {
  it("lets a well-formed call through", () => {
    expect(() =>
      validateToolCallArgs(
        call("Read", { filepath: "src/a.ts" }),
        readFileTool,
      ),
    ).not.toThrow();
    expect(() =>
      validateToolCallArgs(
        call("Read", { filepath: "src/a.ts", start_line: 10, end_line: 20 }),
        readFileTool,
      ),
    ).not.toThrow();
  });

  it("names a missing required argument and shows the shape instead", () => {
    expect(() =>
      validateToolCallArgs(call("Read", {}), readFileTool),
    ).toThrowError(/filepath.*required by this tool and not sent/s);

    const error = (() => {
      try {
        validateToolCallArgs(call("Read", {}), readFileTool);
      } catch (thrown) {
        return thrown as Error;
      }
      throw new Error("expected a rejection");
    })();

    expect(error).toBeInstanceOf(ContinueError);
    expect(error.message).toContain(
      'Expected: {"filepath": string, "start_line"?: number, "end_line"?: number}',
    );
  });

  it("points at the argument that was sent under another name", () => {
    const message = () => {
      try {
        validateToolCallArgs(call("Read", { path: "src/a.ts" }), readFileTool);
      } catch (thrown) {
        return (thrown as Error).message;
      }
      return "";
    };

    expect(message()).toContain('a value arrived as "path"');
    expect(message()).toContain('this tool names it "filepath"');
  });

  it("rejects a value of the wrong type and quotes what arrived", () => {
    const issues = findArgIssues(readFileTool.parameters, {
      filepath: "src/a.ts",
      start_line: "10",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"start_line": expected a number, got string');
    expect(issues[0]).toContain('"10"');
  });

  it("goes into an array's items, which the old check could not see", () => {
    const issues = findArgIssues(multiEditTool.parameters, {
      file_path: "src/a.ts",
      edits: [{ old_string: "a", new_string: "b" }, { old_string: 5 }],
    });

    expect(issues).toContainEqual(
      expect.stringContaining(
        '"edits[1].old_string": expected a string, got integer (5)',
      ),
    );
    expect(issues).toContainEqual(
      expect.stringContaining('"edits[1].new_string"'),
    );
    expect(issues).toHaveLength(2);
  });

  it("rejects an array sent as an object and an object sent as a string", () => {
    expect(
      findArgIssues(multiEditTool.parameters, {
        file_path: "a",
        edits: { old_string: "a", new_string: "b" },
      })[0],
    ).toContain('"edits": expected an array, got object');

    expect(findArgIssues(readFileTool.parameters, "src/a.ts")[0]).toContain(
      "arguments must be a single JSON object, got string",
    );
  });

  it("checks an enum against the options the tool declared", () => {
    const demo = tool({
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", description: "", enum: ["add", "remove"] },
      },
    });

    expect(findArgIssues(demo.parameters, { mode: "drop" })).toEqual([
      '"mode": "drop" is not one of "add", "remove"',
    ]);
    expect(findArgIssues(demo.parameters, { mode: "add" })).toEqual([]);
  });

  it("reaches into a nested object, but refuses to guess about a schema it does not know", () => {
    const demo = tool({
      type: "object",
      required: ["filter"],
      properties: {
        filter: {
          type: "object",
          description: "",
          required: ["path"],
          properties: {
            path: { type: "string", description: "" },
            deep: { type: "boolean", description: "" },
          },
        },
        // A schema the reader was not built for: no type, or a union of them.
        flexible: { type: "", description: "" },
      },
    });

    expect(
      findArgIssues(demo.parameters, {
        filter: { deep: "yes" },
        flexible: { anyOf: [1, 2] },
      }),
    ).toEqual([
      '"filter.path": required by this tool and not sent',
      '"filter.deep": expected a boolean, got string ("yes")',
    ]);
  });

  it("describes the whole shape, optional fields marked, arrays shown as items", () => {
    expect(describeExpectedArgs(multiEditTool.parameters)).toContain(
      '"edits": [{"old_string": string',
    );
    expect(describeExpectedArgs(readFileTool.parameters)).toContain(
      '"start_line"?: number',
    );
  });

  it("reports every problem at once, because one field per round is one round per field", () => {
    const issues = findArgIssues(multiEditTool.parameters, {
      edits: [{ old_string: "a" }, "not-an-edit"],
    });

    // The missing top-level argument, the missing field inside the first item,
    // and the second item not being an object at all - one answer, not three
    // rounds of being told.
    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toContain("file_path");
    expect(issues.join("\n")).toContain("new_string");
    expect(issues.join("\n")).toContain(
      "edits[1]: expected an object, got string",
    );
  });
});
