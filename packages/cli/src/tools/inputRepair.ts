import type { ParameterSchema, ToolParametersSchema } from "./types.js";

export interface RepairNote {
  key: string;
  rule: string;
  fix: string;
}

export interface RepairedInput {
  input: Record<string, unknown>;
  repairs: RepairNote[];
}

type FieldRepair =
  | { kind: "keep" }
  | { kind: "drop"; rule: string; fix: string }
  | { kind: "set"; value: unknown; rule: string; fix: string };

const KEEP: FieldRepair = { kind: "keep" };
const PATH_LIKE_KEY = /path|file|dir/i;
const MARKDOWN_LINK = /^\[[^\]]*\]\(([^)]+)\)$/;

function set(value: unknown, rule: string, fix: string): FieldRepair {
  return { kind: "set", value, rule, fix };
}

function drop(rule: string, fix: string): FieldRepair {
  return { kind: "drop", rule, fix };
}

function coerceNumber(value: unknown, expected: string): FieldRepair {
  if (typeof value !== "string" || value.trim() === "") {
    return KEEP;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return KEEP;
  }
  if (expected === "integer" && !Number.isInteger(parsed)) {
    return KEEP;
  }
  return set(parsed, "coerceStringToNumber", "Converted a string to a number.");
}

function coerceBoolean(value: unknown): FieldRepair {
  if (typeof value !== "string") {
    return KEEP;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "false") {
    return set(
      normalized === "true",
      "coerceStringToBoolean",
      "Converted a string to a boolean.",
    );
  }
  return KEEP;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  const looksStructured =
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"));
  if (!looksStructured) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function repairArray(
  name: string,
  schema: ParameterSchema,
  value: unknown,
  notes: RepairNote[],
): FieldRepair {
  let items: unknown[];
  let rule: string;
  if (Array.isArray(value)) {
    items = value;
    rule = "";
  } else {
    const parsed = parseJson(value);
    if (Array.isArray(parsed)) {
      items = parsed;
      rule = "parseJsonStringifiedArray";
    } else {
      items = [value];
      rule = "wrapBareScalarAsArray";
    }
  }

  if (schema.items?.type === "object" && schema.items.properties) {
    const itemProperties = schema.items.properties;
    items = items.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return item;
      }
      return repairObject(
        item as Record<string, unknown>,
        itemProperties,
        schema.items?.required ?? [],
        `${name}[${index}].`,
        notes,
      );
    });
  }

  if (rule === "") {
    // The array itself did not need a repair, but its items may have; write
    // the repaired items back so the caller keeps them without a bogus note
    // on the array key.
    items.forEach((item, index) => {
      (value as unknown[])[index] = item;
    });
    return KEEP;
  }
  return set(
    items,
    rule,
    rule === "wrapBareScalarAsArray"
      ? "Wrapped a single value in an array."
      : "Parsed a JSON string into an array.",
  );
}

function repairObjectValue(
  name: string,
  value: unknown,
  isRequired: boolean,
): FieldRepair {
  const emptyPlaceholder =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;
  if (!isRequired && emptyPlaceholder) {
    return drop(
      "dropEmptyObjectPlaceholder",
      "Dropped an empty object placeholder.",
    );
  }
  const parsed = parseJson(value);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return set(
      parsed,
      "parseJsonStringifiedObject",
      "Parsed a JSON string into an object.",
    );
  }
  return KEEP;
}

function repairString(name: string, value: unknown): FieldRepair {
  if (typeof value !== "string" || !PATH_LIKE_KEY.test(name)) {
    return KEEP;
  }
  const match = MARKDOWN_LINK.exec(value.trim());
  return match
    ? set(
        match[1],
        "stripMarkdownLinkFromPath",
        "Unwrapped a markdown link in a path field.",
      )
    : KEEP;
}

function repairField(
  name: string,
  schema: ParameterSchema,
  value: unknown,
  isRequired: boolean,
  notes: RepairNote[],
): FieldRepair {
  switch (schema.type) {
    case "number":
    case "integer":
      return coerceNumber(value, schema.type);
    case "boolean":
      return coerceBoolean(value);
    case "array":
      return repairArray(name, schema, value, notes);
    case "object":
      return repairObjectValue(name, value, isRequired);
    case "string":
      return repairString(name, value);
    default:
      return KEEP;
  }
}

function normalizeKeys(
  input: Record<string, unknown>,
  properties: Record<string, ParameterSchema>,
  prefix: string,
  notes: RepairNote[],
): Record<string, unknown> {
  const working: Record<string, unknown> = { ...input };
  for (const key of Object.keys(working)) {
    if (!key.endsWith("?")) continue;
    const base = key.slice(0, -1);
    if (base in properties && !(base in working)) {
      working[base] = working[key];
      delete working[key];
      notes.push({
        key: `${prefix}${key}`,
        rule: "stripOptionalMarkerFromKey",
        fix: `Renamed \`${key}\` to \`${base}\`.`,
      });
    }
  }
  return working;
}

function repairObject(
  input: Record<string, unknown>,
  properties: Record<string, ParameterSchema>,
  required: readonly string[],
  prefix: string,
  notes: RepairNote[],
): Record<string, unknown> {
  const working = normalizeKeys(input, properties, prefix, notes);

  for (const [name, schema] of Object.entries(properties)) {
    if (!(name in working)) continue;
    const key = `${prefix}${name}`;
    const value = working[name];

    if (value === null || value === undefined) {
      delete working[name];
      notes.push({
        key,
        rule: "dropNullOrUndefinedField",
        fix: `Dropped \`${key}\`, which was empty.`,
      });
      continue;
    }

    const repair = repairField(
      name,
      schema,
      value,
      required.includes(name),
      notes,
    );
    if (repair.kind === "drop") {
      delete working[name];
    } else if (repair.kind === "set") {
      working[name] = repair.value;
    }
    if (repair.kind !== "keep") {
      notes.push({ key, rule: repair.rule, fix: repair.fix });
    }
  }

  return working;
}

/**
 * Repairs the argument shapes a model gets structurally wrong but semantically
 * right - a number sent as a string, one value where a list was expected - so a
 * recoverable call is not a lost round. It never renames a near-miss key: the
 * validator's name-the-arrived-key message teaches the model, while a silent
 * guess could write the wrong field.
 */
export function repairToolInput(
  input: Record<string, unknown>,
  schema: ToolParametersSchema,
): RepairedInput {
  const notes: RepairNote[] = [];
  const repaired = repairObject(
    input,
    schema.properties ?? {},
    schema.required ?? [],
    "",
    notes,
  );
  return { input: repaired, repairs: notes };
}
