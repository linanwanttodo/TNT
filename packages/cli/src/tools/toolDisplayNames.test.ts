import { describe, expect, it } from "vitest";

import { applyPatchTool } from "./applyPatch.js";
import { checkBackgroundJobTool } from "./checkBackgroundJob.js";
import { globFilesTool } from "./globFiles.js";
import { enterPlanModeTool, exitPlanModeTool } from "./planMode.js";
import { readFileTool } from "./readFile.js";
import { searchCodeTool } from "./searchCode.js";
import { viewDiffTool } from "./viewDiff.js";

import { getToolDisplayName } from "./index.js";

/**
 * The label a tool declares for itself is what the permission prompt, the result
 * summary and the call title are supposed to show. It was read out of
 * `ALL_BUILT_IN_TOOLS` only, which is a copy of part of the shipped surface - so
 * the tools this module adds beyond that copy printed their code name and the
 * author's label was discarded without a sound.
 *
 * The cases below deliberately mix both groups: tools the registry copy holds and
 * tools only the composed surface offers.
 */
const DECLARED = [
  checkBackgroundJobTool,
  enterPlanModeTool,
  exitPlanModeTool,
  globFilesTool,
  readFileTool,
  searchCodeTool,
  applyPatchTool,
  viewDiffTool,
];

describe("the label a tool declares is the label shown", () => {
  it("covers tools on both sides of the list split", () => {
    expect(DECLARED.length).toBeGreaterThanOrEqual(8);
    for (const tool of DECLARED) {
      expect(getToolDisplayName(tool.name), tool.name).toBe(tool.displayName);
    }
  });

  it("spells the background-job tool the way its own module says", () => {
    // The one case where the discarded label was visible: the code name runs the
    // words together, and the UI showed that.
    expect(getToolDisplayName("CheckBackgroundJob")).toBe(
      "Check Background Job",
    );
  });

  it("still answers with the name for a tool nobody declares", () => {
    expect(getToolDisplayName("NoSuchToolAtAll")).toBe("NoSuchToolAtAll");
  });
});
