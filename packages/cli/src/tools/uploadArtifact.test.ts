import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCurrentSessionId } from "../session/index.js";

import { uploadArtifactTool } from "./uploadArtifact.js";

/**
 * The tool writes into the current session's own directory, so every case here
 * runs against a throwaway `HOME` with `CONTINUE_CLI_TEST` set - the same pair the
 * session store reads - and then names the path it expects rather than trusting
 * the tool to report where it put the file.
 */
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_SESSION_BYTES = 500 * 1024 * 1024;

let home: string;
let previous: { home?: string; test?: string };
let sourceDir: string;

function artifactsDir(): string {
  return path.join(
    home,
    ".tnt",
    "sessions",
    getCurrentSessionId(),
    "artifacts",
  );
}

/** A file with a given size and no content - `statSync` reports the size. */
function sparse(name: string, bytes: number): string {
  const full = path.join(sourceDir, name);
  fs.writeFileSync(full, "");
  fs.truncateSync(full, bytes);
  return full;
}

async function save(filePath: string): Promise<string> {
  return (await uploadArtifactTool.run({ filePath })) as string;
}

beforeEach(() => {
  previous = {
    home: process.env.HOME,
    test: process.env.CONTINUE_CLI_TEST,
  };
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-artifacts-"));
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-artifact-src-"));
  process.env.HOME = home;
  process.env.CONTINUE_CLI_TEST = "1";
});

afterEach(() => {
  for (const [key, value] of [
    ["HOME", previous.home],
    ["CONTINUE_CLI_TEST", previous.test],
  ] as [string, string | undefined][]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of [home, sourceDir]) {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

describe("the artifact tool", () => {
  it("copies the file into the session's artifacts and names the path", async () => {
    const source = path.join(sourceDir, "shot.png");
    fs.writeFileSync(source, "PNGDATA");

    const result = await save(source);

    const saved = path.join(artifactsDir(), "shot.png");
    expect(fs.readFileSync(saved, "utf-8")).toBe("PNGDATA");
    expect(result).toContain("shot.png");
    expect(result).toContain("0.00 MB");
    // Nothing may survive alongside the renamed copy.
    expect(fs.readdirSync(artifactsDir())).toEqual(["shot.png"]);
  });

  it("replaces an artifact of the same name instead of keeping both", async () => {
    const first = path.join(sourceDir, "plot.html");
    fs.writeFileSync(first, "<html>v1</html>");
    await save(first);

    const second = path.join(sourceDir, "other", "plot.html");
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.writeFileSync(second, "<html>v2</html>");
    await save(second);

    expect(fs.readdirSync(artifactsDir())).toEqual(["plot.html"]);
    expect(
      fs.readFileSync(path.join(artifactsDir(), "plot.html"), "utf-8"),
    ).toBe("<html>v2</html>");
  });

  it("refuses a path that is not there, and says which", async () => {
    const missing = path.join(sourceDir, "gone.log");
    await expect(save(missing)).rejects.toThrow(/File not found/);
  });

  it("refuses a file type a reviewer cannot open", async () => {
    const source = path.join(sourceDir, "payload.exe");
    fs.writeFileSync(source, "MZ");
    await expect(save(source)).rejects.toThrow(/File type not supported/);
  });

  it("refuses one file over the 50MB ceiling", async () => {
    const source = sparse("huge.mov", MAX_ARTIFACT_BYTES + 1);
    await expect(save(source)).rejects.toThrow(/too large/);
    expect(fs.existsSync(path.join(artifactsDir(), "huge.mov"))).toBe(false);
  });

  it("refuses a save that would push the session past 500MB", async () => {
    for (let index = 0; index < 10; index++) {
      await save(sparse(`part${index}.log`, 49 * 1024 * 1024));
    }

    // 10 x 49MB is 490MB, so only a file that crosses the remaining 10MB fits
    // the ceiling.
    await expect(save(sparse("extra.txt", 15 * 1024 * 1024))).rejects.toThrow(
      /500MB limit/,
    );
  });

  it("counts the file being replaced as free space, not as a second copy", async () => {
    // Same shape as the case above - 10 x 49MB already saved - but the eleventh
    // save reuses one of those names. Without the "minus the replaced file"
    // accounting this trips the ceiling it just cleared by a name.
    for (let index = 0; index < 10; index++) {
      await save(sparse(`part${index}.log`, 49 * 1024 * 1024));
    }

    const total = fs
      .readdirSync(artifactsDir())
      .reduce(
        (sum, name) => sum + fs.statSync(path.join(artifactsDir(), name)).size,
        0,
      );
    expect(total).toBeLessThanOrEqual(MAX_SESSION_BYTES);

    await expect(
      save(sparse("part3.log", 49 * 1024 * 1024)),
    ).resolves.toContain("part3.log");
  });
});
