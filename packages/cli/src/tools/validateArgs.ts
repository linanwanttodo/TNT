import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

import {
  ParameterSchema,
  Tool,
  ToolCall,
  ToolParametersSchema,
} from "./types.js";

// A rejected call is only useful if the model can fix it in the next round, so
// every problem is named with the path it was found at, the value that arrived,
// and the shape the tool expects. An error that says "invalid arguments" makes
// the model guess again.
const MAX_VALUE_LENGTH = 80;

type JsonType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object";

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

function showValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}...`
    : text;
}

function typeProblem(expected: string, value: unknown): string | undefined {
  const sent = actualType(value);
  switch (expected) {
    case "integer":
      return sent === "integer"
        ? undefined
        : `expected an integer, got ${sent}`;
    case "number":
      return sent === "integer" || sent === "number"
        ? undefined
        : `expected a number, got ${sent}`;
    case "string":
      return sent === "string" ? undefined : `expected a string, got ${sent}`;
    case "boolean":
      return sent === "boolean" ? undefined : `expected a boolean, got ${sent}`;
    case "array":
      return sent === "array" ? undefined : `expected an array, got ${sent}`;
    case "object":
      return sent === "object" ? undefined : `expected an object, got ${sent}`;
    default:
      // A schema this reader does not understand (anyOf, $ref, a missing type)
      // is not a verdict against the call.
      return undefined;
  }
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < columns; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// The most common bad call is a right idea with the wrong key name, and the fix
// is one word, so it is worth naming.
function closestTo(name: string, sent: string[]): string | undefined {
  const wanted = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.max(3, Math.ceil(name.length / 3));
  for (const key of sent) {
    const lower = key.toLowerCase();
    // "path" for a tool that names it "filepath" is the same argument by a
    // different name, and edit distance alone is too strict to see it.
    if (
      lower !== wanted &&
      (wanted.includes(lower) || lower.includes(wanted))
    ) {
      return key;
    }
    const distance = editDistance(wanted, lower);
    if (distance > 0 && distance <= bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

// A problem is always named by the path it was found at, so the model can fix
// that one field instead of re-reading the whole schema.
function label(path: string, name: string): string {
  return `"${path ? `${path}.${name}` : name}"`;
}

function issuesForObject(
  schema: {
    properties?: Record<string, ParameterSchema>;
    required?: string[];
  },
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): void {
  const properties = schema.properties ?? {};
  for (const name of schema.required ?? []) {
    const sent = value[name];
    if (sent !== undefined && sent !== null) continue;
    const near = closestTo(name, Object.keys(value));
    issues.push(
      `${label(path, name)}: required by this tool and not sent${near ? ` (a value arrived as "${near}" - this tool names it "${name}")` : ""}`,
    );
  }

  for (const [name, expected] of Object.entries(properties)) {
    const sent = value[name];
    if (sent === undefined || sent === null) continue;
    const at = path ? `${path}.${name}` : name;
    const problem = typeProblem(expected.type, sent);
    if (problem) {
      issues.push(`${label(path, name)}: ${problem} (${showValue(sent)})`);
      continue;
    }
    if (
      expected.enum &&
      typeof sent === "string" &&
      !expected.enum.includes(sent)
    ) {
      issues.push(
        `${label(path, name)}: ${showValue(sent)} is not one of ${expected.enum.map((option) => `"${option}"`).join(", ")}`,
      );
      continue;
    }
    if (expected.type === "array" && Array.isArray(sent) && expected.items) {
      const items = expected.items;
      sent.forEach((item, index) => {
        const itemPath = `${at}[${index}]`;
        const problem = typeProblem(items.type, item);
        if (problem) {
          issues.push(`${itemPath}: ${problem} (${showValue(item)})`);
          return;
        }
        if (items.properties && typeof item === "object" && item !== null) {
          issuesForObject(
            items,
            item as Record<string, unknown>,
            itemPath,
            issues,
          );
        }
      });
      return;
    }
    if (
      expected.type === "object" &&
      expected.properties &&
      typeof sent === "object" &&
      !Array.isArray(sent)
    ) {
      issuesForObject(expected, sent as Record<string, unknown>, at, issues);
    }
  }
}

export function findArgIssues(
  parameters: ToolParametersSchema,
  args: unknown,
): string[] {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return [
      `arguments must be a single JSON object, got ${actualType(args)} (${showValue(args)})`,
    ];
  }
  const issues: string[] = [];
  issuesForObject(parameters, args as Record<string, unknown>, "", issues);
  return issues;
}

function describeValue(schema: ParameterSchema): string {
  if (schema.type === "object" && schema.properties) {
    return `{${describeProperties(schema)}}`;
  }
  if (schema.type === "array") {
    const items = schema.items;
    if (items?.type === "object" && items.properties) {
      const nested: ParameterSchema = {
        type: "object",
        description: "",
        properties: items.properties,
        required: items.required,
      };
      return `[{${describeValue(nested).slice(1, -1)}}]`;
    }
    return `[${items ? (items.type ?? "unknown") : "unknown"}]`;
  }
  if (schema.enum) {
    return schema.enum.map((option) => `"${option}"`).join("|");
  }
  return schema.type ?? "unknown";
}

function describeProperties(schema: {
  properties?: Record<string, ParameterSchema>;
  required?: string[];
}): string {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .map(
      ([name, value]) =>
        `"${name}"${required.has(name) ? "" : "?"}: ${describeValue(value)}`,
    )
    .join(", ");
}

/** The shape the tool wanted, in one line, so the next call can copy it. */
export function describeExpectedArgs(parameters: ToolParametersSchema): string {
  return `{${describeProperties(parameters)}}`;
}

/**
 * Check a call against the tool's own parameter schema, to the depth the schema
 * declares. Throws with everything that is wrong at once, because a call fixed
 * one field at a time costs one round per field.
 */
export function validateToolCallArgs(toolCall: ToolCall, tool: Tool): void {
  const issues = findArgIssues(tool.parameters, toolCall.arguments);
  if (issues.length === 0) return;

  throw new ContinueError(
    ContinueErrorReason.InvalidToolArgs,
    `Invalid arguments for tool "${toolCall.name}":\n- ${issues.join(
      "\n- ",
    )}\nExpected: ${describeExpectedArgs(tool.parameters)}`,
  );
}
