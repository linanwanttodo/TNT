import fs from "fs";
import os from "os";
import path from "path";

import { DEFAULT_SECURITY_IGNORE_FILETYPES } from "core/indexing/ignore.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MARKER_FILE_CREATED } from "./resultMarkers.js";
import { writeFileTool } from "./writeFile.js";

/**
 * Read and Edit already refuse files that may hold credentials; Write did not,
 * so the one tool that replaces a file's whole contents could overwrite the
 * project's settings or a key file. Both hooks are asserted: the engine calls
 * `preprocess`, while shell mode and the serve/SDK routes call `run` directly.
 */
describe("the Write tool refuses credential files", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-write-guard-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("names a file the guard list really covers", () => {
    // Floor: without this the refusals below could pass against a filename
    // nothing blocks, for the wrong reason.
    expect(DEFAULT_SECURITY_IGNORE_FILETYPES.length).toBeGreaterThan(0);
  });

  it("refuses an environment file in preprocess", async () => {
    await expect(
      writeFileTool.preprocess!({
        filepath: path.join(dir, ".env"),
        content: "SECRET=1\n",
      }),
    ).rejects.toThrow(/security concern/i);
  });

  it("refuses the project's settings file in preprocess", async () => {
    await expect(
      writeFileTool.preprocess!({
        filepath: path.join(dir, ".tnt", "settings.json"),
        content: "{}\n",
      }),
    ).rejects.toThrow(/security concern/i);
  });

  it("refuses a key file in preprocess", async () => {
    await expect(
      writeFileTool.preprocess!({
        filepath: path.join(dir, "server.key"),
        content: "not-a-real-key\n",
      }),
    ).rejects.toThrow(/security concern/i);
  });

  it("lets an ordinary file through", async () => {
    const processed = await writeFileTool.preprocess!({
      filepath: path.join(dir, "app.ts"),
      content: "export const a = 1;\n",
    });

    expect(processed.args).toBeDefined();
  });

  it("does not leak the content through the refusal", async () => {
    const message = await writeFileTool.preprocess!({
      filepath: path.join(dir, ".env"),
      content: "super-secret-value\n",
    })
      .then(() => "")
      .catch((error: unknown) => String((error as Error).message));

    expect(message).toMatch(/not allowed/i);
    expect(message).not.toContain("super-secret-value");
  });

  it("refuses through run() before the file is touched", async () => {
    const secret = path.join(dir, ".env");
    fs.writeFileSync(secret, "ORIGINAL=1\n");

    await expect(
      writeFileTool.run({ filepath: secret, content: "REPLACED=1\n" }),
    ).rejects.toThrow(/security concern/i);

    expect(fs.readFileSync(secret, "utf-8")).toBe("ORIGINAL=1\n");
  });

  it("does not create a refused file", async () => {
    const secret = path.join(dir, "new.env");

    await expect(
      writeFileTool.run({ filepath: secret, content: "X=1\n" }),
    ).rejects.toThrow(/security concern/i);

    expect(fs.existsSync(secret)).toBe(false);
  });

  it("still writes an ordinary file", async () => {
    const target = path.join(dir, "notes.ts");

    const result = await writeFileTool.run({
      filepath: target,
      content: "export const a = 1;\n",
    });

    expect(fs.readFileSync(target, "utf-8")).toBe("export const a = 1;\n");
    expect(result).toContain(MARKER_FILE_CREATED);
  });
});
