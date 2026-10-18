import fs from "fs";
import os from "os";
import path from "path";

import { DEFAULT_SECURITY_IGNORE_FILETYPES } from "core/indexing/ignore.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { editTool } from "./edit.js";
import { readFileTool } from "./readFile.js";

/**
 * The CLI refuses to read or edit files that may hold credentials, and until now nothing in
 * this package or in core asserted it. That is how the equivalent control in the IDE's context
 * providers was deleted by a commit titled "cleanup file security pr" without any gate going
 * red: an unasserted security check is a check waiting to be removed.
 *
 * Asserted through `preprocess`, because that is the single hook the engine calls before
 * running a tool (`stream/streamChatResponse.helpers.ts:583`) and therefore the contract the
 * refusal actually travels on today. `run()` deliberately is not asserted here - whether the
 * guard belongs there too is open as a placement decision, and a test would pre-empt it by
 * pinning one shape or the other.
 *
 * The refused filename comes from the same list the guard consults, so editing that list keeps
 * testing something real rather than testing a hard-coded guess about it.
 */
describe("the engine's tool preprocessing refuses credential files", () => {
  let dir: string;
  let secretPath: string;
  let ordinaryPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-secret-guard-"));
    const extension = DEFAULT_SECURITY_IGNORE_FILETYPES[0];
    secretPath = path.join(dir, `keys${extension}`);
    ordinaryPath = path.join(dir, "ordinary.ts");
    fs.writeFileSync(secretPath, "API_KEY=super-secret-value\n");
    fs.writeFileSync(ordinaryPath, "export const a = 1;\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("names a file the guard list really covers", () => {
    // Floor: without this the next two cases could pass against a filename nothing blocks.
    expect(DEFAULT_SECURITY_IGNORE_FILETYPES.length).toBeGreaterThan(0);
  });

  it("refuses Read before any content is produced", async () => {
    await expect(
      readFileTool.preprocess!({ filepath: secretPath }),
    ).rejects.toThrow(/security concern/i);
  });

  it("refuses Edit on the same path", async () => {
    await expect(
      editTool.preprocess!({
        file_path: secretPath,
        edits: [{ old_string: "super-secret-value", new_string: "rotated" }],
      }),
    ).rejects.toThrow(/security concern/i);
  });

  it("lets an ordinary file through, so the refusal is not a blanket block", async () => {
    const processed = await readFileTool.preprocess!({
      filepath: ordinaryPath,
    });
    expect(processed.args).toBeDefined();
    expect(JSON.stringify(processed.preview)).toContain("ordinary.ts");
  });

  it("does not leak the secret through the refusal message", async () => {
    const message = await readFileTool.preprocess!({ filepath: secretPath })
      .then(() => "")
      .catch((error: unknown) => String((error as Error).message));

    expect(message).toMatch(/not allowed/i);
    expect(message).not.toContain("super-secret-value");
  });
});
