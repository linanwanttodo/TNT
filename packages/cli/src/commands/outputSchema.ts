import * as fs from "fs";

export class OutputSchemaError extends Error {}

/**
 * The JSON Schema keywords this validator enforces. A schema that uses
 * anything else in this position is refused at load time rather than silently
 * half-checked: a validator that ignores `oneOf` would report "valid" for a
 * response it never checked, and a run that says "matches the schema" has to
 * mean it.
 */
const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
]);

/** Annotation-only keywords: meaningful to humans and tools, ignored in checking. */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "default",
  "examples",
  "$comment",
]);

const SPEC_KEYWORDS: ReadonlySet<string> = new Set([
  "$ref",
  "$defs",
  "definitions",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "contains",
  "propertyNames",
  "prefixItems",
  "uniqueItems",
  "multipleOf",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

function assertSupported(
  schema: unknown,
  path: string,
  problems: string[],
): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return;
  }
  const record = schema as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SUPPORTED_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) {
      continue;
    }
    if (SPEC_KEYWORDS.has(key)) {
      problems.push(`${path}: "${key}" is not supported by --output-schema`);
    }
  }
  if (record.pattern !== undefined) {
    try {
      new RegExp(record.pattern as string);
    } catch {
      problems.push(`${path}: "pattern" is not a valid regular expression`);
    }
  }
  if (record.properties && typeof record.properties === "object") {
    for (const [name, child] of Object.entries(
      record.properties as Record<string, unknown>,
    )) {
      assertSupported(child, `${path}.properties.${name}`, problems);
    }
  }
  if (record.items !== undefined) {
    assertSupported(record.items, `${path}.items`, problems);
  }
}

/** Reads and parses the file, refusing schemas this validator cannot enforce. */
export function loadOutputSchema(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new OutputSchemaError(`Output schema file not found: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new OutputSchemaError(
      `Output schema at ${filePath} is not valid JSON: ${(error as Error).message}`,
    );
  }
  const problems: string[] = [];
  assertSupported(parsed, "$", problems);
  if (problems.length > 0) {
    throw new OutputSchemaError(
      `Output schema at ${filePath} uses keywords this validator cannot enforce:\n- ${problems.join("\n- ")}`,
    );
  }
  return parsed;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "null":
      return value === null;
    case "string":
    case "boolean":
      return typeof value === type;
    default:
      return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (
    typeof a === "object" &&
    a !== null &&
    !Array.isArray(a) &&
    typeof b === "object" &&
    b !== null &&
    !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) =>
        deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
      )
    );
  }
  return false;
}

/** False when the type check already failed and deeper checks are noise. */
function checkType(
  value: unknown,
  record: Record<string, unknown>,
  path: string,
  errors: string[],
): boolean {
  if (record.type === undefined) return true;
  const types = Array.isArray(record.type)
    ? (record.type as string[])
    : [record.type as string];
  if (types.some((type) => matchesType(value, type))) return true;
  errors.push(
    `${path}: expected ${types.join(" or ")}, got ${typeName(value)}`,
  );
  return false;
}

function checkEnumAndConst(
  value: unknown,
  record: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (
    record.enum !== undefined &&
    Array.isArray(record.enum) &&
    !record.enum.some((allowed) => deepEqual(value, allowed))
  ) {
    errors.push(`${path}: value is not one of the allowed values`);
  }
  if (record.const !== undefined && !deepEqual(value, record.const)) {
    errors.push(`${path}: value is not the required constant`);
  }
}

function checkObject(
  obj: Record<string, unknown>,
  record: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (Array.isArray(record.required)) {
    for (const key of record.required as string[]) {
      if (!(key in obj)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
  }
  const properties =
    typeof record.properties === "object" && record.properties !== null
      ? (record.properties as Record<string, unknown>)
      : {};
  for (const [key, child] of Object.entries(properties)) {
    if (key in obj) {
      validateValue(obj[key], child, `${path}.${key}`, errors);
    }
  }
  if (record.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in properties)) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }
}

function checkArray(
  value: unknown[],
  record: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (record.items !== undefined) {
    value.forEach((item, index) =>
      validateValue(item, record.items, `${path}[${index}]`, errors),
    );
  }
  if (typeof record.minItems === "number" && value.length < record.minItems) {
    errors.push(`${path}: expected at least ${record.minItems} items`);
  }
  if (typeof record.maxItems === "number" && value.length > record.maxItems) {
    errors.push(`${path}: expected at most ${record.maxItems} items`);
  }
}

function checkString(
  value: string,
  record: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  // Code points, not UTF-16 units, so a length limit means what a JSON
  // Schema author expects for non-ASCII text.
  const length = [...value].length;
  if (typeof record.minLength === "number" && length < record.minLength) {
    errors.push(`${path}: expected at least ${record.minLength} characters`);
  }
  if (typeof record.maxLength === "number" && length > record.maxLength) {
    errors.push(`${path}: expected at most ${record.maxLength} characters`);
  }
  if (
    typeof record.pattern === "string" &&
    !new RegExp(record.pattern).test(value)
  ) {
    errors.push(`${path}: does not match the required pattern`);
  }
}

function checkNumber(
  value: number,
  record: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (typeof record.minimum === "number" && value < record.minimum) {
    errors.push(`${path}: expected a value >= ${record.minimum}`);
  }
  if (typeof record.maximum === "number" && value > record.maximum) {
    errors.push(`${path}: expected a value <= ${record.maximum}`);
  }
}

function validateValue(
  value: unknown,
  schema: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return;
  }
  const record = schema as Record<string, unknown>;

  if (!checkType(value, record, path, errors)) return;
  checkEnumAndConst(value, record, path, errors);

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    checkObject(value as Record<string, unknown>, record, path, errors);
  }
  if (Array.isArray(value)) {
    checkArray(value, record, path, errors);
  }
  if (typeof value === "string") {
    checkString(value, record, path, errors);
  }
  if (typeof value === "number") {
    checkNumber(value, record, path, errors);
  }
}

/** Every way the response text fails the schema; empty means it conforms. */
export function validateAgainstSchema(
  response: string,
  schema: unknown,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim());
  } catch (error) {
    return [`the response is not valid JSON: ${(error as Error).message}`];
  }
  const errors: string[] = [];
  validateValue(parsed, schema, "$", errors);
  return errors;
}

/**
 * Returns the response when it conforms, otherwise asks the model once to fix
 * it. A second failure is final: the run is reported as failed instead of
 * printing something that does not match the schema the caller asked for.
 */
export async function enforceOutputSchema(
  response: string,
  schema: unknown,
  repair: (invalidText: string, errors: string[]) => Promise<string>,
): Promise<string> {
  const firstErrors = validateAgainstSchema(response, schema);
  if (firstErrors.length === 0) return response;

  const repaired = await repair(response, firstErrors);
  const secondErrors = validateAgainstSchema(repaired, schema);
  if (secondErrors.length === 0) return repaired;

  throw new OutputSchemaError(
    `The final response does not match --output-schema after one repair attempt:\n- ${secondErrors.join("\n- ")}`,
  );
}

/** The prompt block that tells the model what shape the answer must take. */
export function describeSchemaForPrompt(schema: unknown): string {
  return `The final answer of this run must be a single JSON document that conforms to this JSON Schema. Reply with only that JSON document, with no text before or after it.\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
}
