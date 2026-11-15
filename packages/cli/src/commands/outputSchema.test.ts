import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  describeSchemaForPrompt,
  enforceOutputSchema,
  loadOutputSchema,
  OutputSchemaError,
  validateAgainstSchema,
} from "./outputSchema.js";

const objectSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    count: { type: "integer" },
  },
  required: ["name"],
  additionalProperties: false,
};

describe("validateAgainstSchema", () => {
  it("accepts a conforming document", () => {
    expect(
      validateAgainstSchema('{"name": "ok", "count": 2}', objectSchema),
    ).toEqual([]);
  });

  it("reports a missing required property with its path", () => {
    const errors = validateAgainstSchema('{"count": 2}', objectSchema);
    expect(errors).toEqual(['$: missing required property "name"']);
  });

  it("names the expected and actual type", () => {
    const errors = validateAgainstSchema('{"name": 42}', objectSchema);
    expect(errors).toEqual(["$.name: expected string, got number"]);
  });

  it("refuses an unspecified property when additionalProperties is false", () => {
    const errors = validateAgainstSchema(
      '{"name": "ok", "extra": 1}',
      objectSchema,
    );
    expect(errors).toEqual(['$: unexpected property "extra"']);
  });

  it("validates array items with their index in the path", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
    };
    const errors = validateAgainstSchema('["a", 3]', schema);
    expect(errors).toEqual(["$[1]: expected string, got number"]);
  });

  it("distinguishes an integer from a number", () => {
    const schema = { type: "integer" };
    expect(validateAgainstSchema("1.5", schema)).toEqual([
      "$: expected integer, got number",
    ]);
    expect(validateAgainstSchema("1", schema)).toEqual([]);
  });

  it("accepts null only when the type list allows it", () => {
    const schema = { type: ["string", "null"] };
    expect(validateAgainstSchema("null", schema)).toEqual([]);
    expect(validateAgainstSchema("5", schema)).toEqual([
      "$: expected string or null, got number",
    ]);
  });

  it("enforces enum and const", () => {
    expect(validateAgainstSchema('"b"', { enum: ["a", "b"] })).toEqual([]);
    expect(validateAgainstSchema('"c"', { enum: ["a", "b"] })).toEqual([
      "$: value is not one of the allowed values",
    ]);
    expect(validateAgainstSchema("3", { const: 3 })).toEqual([]);
    expect(validateAgainstSchema("4", { const: 3 })).toEqual([
      "$: value is not the required constant",
    ]);
  });

  it("enforces string length in code points", () => {
    const schema = { type: "string", minLength: 2 };
    expect(validateAgainstSchema('"\u00e9\u00e9"', schema)).toEqual([]);
    expect(validateAgainstSchema('"\u00e9"', schema)).toEqual([
      "$: expected at least 2 characters",
    ]);
  });

  it("enforces numeric bounds and patterns", () => {
    expect(validateAgainstSchema("5", { minimum: 6 })).toEqual([
      "$: expected a value >= 6",
    ]);
    expect(validateAgainstSchema('"abc"', { pattern: "^a" })).toEqual([]);
    expect(validateAgainstSchema('"xbc"', { pattern: "^a" })).toEqual([
      "$: does not match the required pattern",
    ]);
  });

  it("reports a response that is not JSON at all", () => {
    const errors = validateAgainstSchema("not json", objectSchema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("the response is not valid JSON");
  });
});

describe("loadOutputSchema", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-schema-"));

  it("reads a schema file", () => {
    const file = path.join(dir, "schema.json");
    fs.writeFileSync(file, JSON.stringify(objectSchema));
    expect(loadOutputSchema(file)).toEqual(objectSchema);
  });

  it("refuses a missing file with the path in the message", () => {
    const file = path.join(dir, "absent.json");
    expect(() => loadOutputSchema(file)).toThrow(OutputSchemaError);
    expect(() => loadOutputSchema(file)).toThrow(file);
  });

  it("refuses a file that is not JSON", () => {
    const file = path.join(dir, "broken.json");
    fs.writeFileSync(file, "{ not json");
    expect(() => loadOutputSchema(file)).toThrow(/is not valid JSON/);
  });

  it("refuses keywords it cannot enforce instead of half-checking", () => {
    const file = path.join(dir, "oneof.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ oneOf: [{ type: "string" }, { type: "number" }] }),
    );
    expect(() => loadOutputSchema(file)).toThrow(/"oneOf" is not supported/);
  });

  it("refuses an invalid pattern at load time", () => {
    const file = path.join(dir, "pattern.json");
    fs.writeFileSync(file, JSON.stringify({ pattern: "([unclosed" }));
    expect(() => loadOutputSchema(file)).toThrow(
      /"pattern" is not a valid regular expression/,
    );
  });
});

describe("enforceOutputSchema", () => {
  it("returns a conforming response without calling repair", async () => {
    const repair = vi.fn();
    const result = await enforceOutputSchema(
      '{"name": "ok"}',
      objectSchema,
      repair,
    );
    expect(result).toBe('{"name": "ok"}');
    expect(repair).not.toHaveBeenCalled();
  });

  it("asks for one repair and returns the corrected text", async () => {
    const repair = vi.fn().mockResolvedValue('{"name": "ok"}');
    const result = await enforceOutputSchema(
      '{"name": 1}',
      objectSchema,
      repair,
    );

    expect(result).toBe('{"name": "ok"}');
    expect(repair).toHaveBeenCalledTimes(1);
    const [invalidText, errors] = repair.mock.calls[0];
    expect(invalidText).toBe('{"name": 1}');
    expect(errors).toEqual(["$.name: expected string, got number"]);
  });

  it("fails when the repaired text still does not match", async () => {
    const repair = vi.fn().mockResolvedValue('{"name": 2}');
    await expect(
      enforceOutputSchema('{"name": 1}', objectSchema, repair),
    ).rejects.toThrow(
      /does not match --output-schema after one repair attempt:\n- \$\.name: expected string, got number/,
    );
    expect(repair).toHaveBeenCalledTimes(1);
  });
});

describe("describeSchemaForPrompt", () => {
  it("embeds the schema as JSON the model can read", () => {
    const note = describeSchemaForPrompt({ type: "object" });
    expect(note).toContain("```json");
    expect(note).toContain('"type": "object"');
    expect(note).toContain("Reply with only that JSON document");
  });
});
