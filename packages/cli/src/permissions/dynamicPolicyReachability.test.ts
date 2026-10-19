import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "../tools/allBuiltIns.js";

/**
 * `evaluateToolCallPolicy` is the per-call hook that lets a tool narrow its own
 * permission - the caller-side check that decides, for one set of arguments, that
 * a request must be excluded rather than merely prompted. Both consumers
 * (`permissions/permissionChecker.ts` and `ui/hooks/useChat.stream.helpers.ts`)
 * reach it the same way: look the tool up in `ALL_BUILT_IN_TOOLS` and call the
 * hook if it is there.
 *
 * So a tool that declares the hook but lives outside that copy gets its security
 * check skipped, silently, on both paths. Today exactly one tool declares it and
 * it is inside the copy; the assertion below is what keeps a second one from
 * being added on the wrong side of the split.
 */
const TOOL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
);

function declaringTools(): { file: string; toolName: string }[] {
  const found: { file: string; toolName: string }[] = [];
  for (const entry of fs.readdirSync(TOOL_DIR)) {
    if (!/\.tsx?$/.test(entry) || /test/.test(entry)) {
      continue;
    }
    const text = fs.readFileSync(path.join(TOOL_DIR, entry), "utf8");
    if (!text.includes("evaluateToolCallPolicy")) {
      continue;
    }
    for (const match of text.matchAll(
      /export const \w+[^=]*=[\s\S]{0,60}?name:\s*"([^"]+)"[\s\S]{0,4000}?\bevaluateToolCallPolicy\b/g,
    )) {
      found.push({ file: entry, toolName: match[1] });
    }
  }
  return found;
}

describe("the tools that evaluate their own permission", () => {
  const declarants = declaringTools();
  const registryNames = ALL_BUILT_IN_TOOLS.map((tool) => tool.name);

  it("finds the declarations it is reasoning about", () => {
    // The scan is the whole check, so an empty result would be a silent pass.
    expect(declarants.length).toBeGreaterThan(0);
  });

  it("reaches every declarant through the copy the permission layer reads", () => {
    const unreachable = declarants.filter(
      ({ toolName }) => !registryNames.includes(toolName),
    );
    expect(
      unreachable.map(({ file, toolName }) => `${toolName} (${file})`),
    ).toEqual([]);
  });
});
