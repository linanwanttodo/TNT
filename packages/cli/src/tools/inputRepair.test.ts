import { describe, expect, it } from "vitest";

import { repairToolInput } from "./inputRepair.js";
import type { ToolParametersSchema } from "./types.js";

const schema: ToolParametersSchema = {
  type: "object",
  required: ["filepath"],
  properties: {
    filepath: { type: "string", description: "path" },
    start_line: { type: "number", description: "first line" },
    end_line: { type: "number", description: "last line" },
    recursive: { type: "boolean", description: "recurse" },
    paths: { type: "array", description: "paths", items: { type: "string" } },
    options: { type: "object", description: "options" },
    edits: {
      type: "array",
      description: "edits",
      items: {
        type: "object",
        properties: {
          old_string: { type: "string", description: "old" },
          replace_all: { type: "boolean", description: "all" },
        },
      },
    },
  },
};

describe("repairToolInput", () => {
  it("coerces numeric strings for number fields", () => {
    const repaired = repairToolInput(
      { filepath: "a.ts", start_line: "10", end_line: "20" },
      schema,
    );

    expect(repaired.input.start_line).toBe(10);
    expect(repaired.input.end_line).toBe(20);
    expect(repaired.repairs.map((note) => note.rule)).toEqual([
      "coerceStringToNumber",
      "coerceStringToNumber",
    ]);
  });

  it("leaves a non-integer string for an integer-only value alone", () => {
    const integerSchema: ToolParametersSchema = {
      type: "object",
      properties: { count: { type: "integer", description: "count" } },
    };

    const repaired = repairToolInput({ count: "3.5" }, integerSchema);

    expect(repaired.input.count).toBe("3.5");
    expect(repaired.repairs).toEqual([]);
  });

  it("coerces boolean strings", () => {
    const repaired = repairToolInput(
      { filepath: "a.ts", recursive: "true" },
      schema,
    );

    expect(repaired.input.recursive).toBe(true);
    expect(repaired.repairs[0].rule).toBe("coerceStringToBoolean");
  });

  it("parses a JSON string sent for an array or object field", () => {
    const array = repairToolInput(
      { filepath: "a.ts", paths: '["a.ts","b.ts"]' },
      schema,
    );
    expect(array.input.paths).toEqual(["a.ts", "b.ts"]);
    expect(array.repairs[0].rule).toBe("parseJsonStringifiedArray");

    const object = repairToolInput(
      { filepath: "a.ts", options: '{"follow":true}' },
      schema,
    );
    expect(object.input.options).toEqual({ follow: true });
    expect(object.repairs[0].rule).toBe("parseJsonStringifiedObject");
  });

  it("wraps a bare value sent for an array field", () => {
    const repaired = repairToolInput(
      { filepath: "a.ts", paths: "a.ts" },
      schema,
    );

    expect(repaired.input.paths).toEqual(["a.ts"]);
    expect(repaired.repairs[0].rule).toBe("wrapBareScalarAsArray");
  });

  it("strips a trailing ? from a known key", () => {
    const repaired = repairToolInput(
      { filepath: "a.ts", "start_line?": 3 },
      schema,
    );

    expect(repaired.input.start_line).toBe(3);
    expect(repaired.input).not.toHaveProperty("start_line?");
    expect(repaired.repairs[0].rule).toBe("stripOptionalMarkerFromKey");
  });

  it("unwraps a markdown link in a path-like field", () => {
    const repaired = repairToolInput({ filepath: "[a.ts](src/a.ts)" }, schema);

    expect(repaired.input.filepath).toBe("src/a.ts");
    expect(repaired.repairs[0].rule).toBe("stripMarkdownLinkFromPath");
  });

  it("does not unwrap markdown in a non-path field", () => {
    const textSchema: ToolParametersSchema = {
      type: "object",
      properties: { text: { type: "string", description: "text" } },
    };

    const repaired = repairToolInput({ text: "[label](target)" }, textSchema);

    expect(repaired.input.text).toBe("[label](target)");
    expect(repaired.repairs).toEqual([]);
  });

  it("drops null and undefined optional fields", () => {
    const repaired = repairToolInput(
      { filepath: "a.ts", start_line: null, end_line: undefined },
      schema,
    );

    expect(repaired.input).toEqual({ filepath: "a.ts" });
    expect(repaired.repairs.map((note) => note.rule)).toEqual([
      "dropNullOrUndefinedField",
      "dropNullOrUndefinedField",
    ]);
  });

  it("drops an empty object placeholder for an optional object field", () => {
    const repaired = repairToolInput({ filepath: "a.ts", options: {} }, schema);

    expect(repaired.input).not.toHaveProperty("options");
    expect(repaired.repairs[0].rule).toBe("dropEmptyObjectPlaceholder");
  });

  it("repairs values inside an array of objects", () => {
    const repaired = repairToolInput(
      {
        filepath: "a.ts",
        edits: [{ old_string: "a", replace_all: "true" }],
      },
      schema,
    );

    expect((repaired.input.edits as any[])[0].replace_all).toBe(true);
    expect(repaired.repairs[0].key).toBe("edits[0].replace_all");
    expect(repaired.repairs[0].rule).toBe("coerceStringToBoolean");
  });

  it("does not rename a near-miss key", () => {
    // Validation owns that answer: it names the arrived key and the wanted one,
    // which teaches the model; silently guessing could write the wrong field.
    const repaired = repairToolInput({ path: "a.ts" }, schema);

    expect(repaired.input).toEqual({ path: "a.ts" });
    expect(repaired.repairs).toEqual([]);
  });

  it("leaves a valid call untouched and does not mutate the input", () => {
    const input = { filepath: "a.ts", start_line: 1, recursive: true };
    const repaired = repairToolInput(input, schema);

    expect(repaired.input).toEqual(input);
    expect(repaired.repairs).toEqual([]);
    expect(repaired.input).not.toBe(input);
    expect(input).toEqual({ filepath: "a.ts", start_line: 1, recursive: true });
  });
});
