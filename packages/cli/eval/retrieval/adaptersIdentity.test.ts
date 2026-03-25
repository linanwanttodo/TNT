import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fromGlobOutput,
  fromRetrievalHits,
  fromSearchOutput,
} from "./adapters.js";

/**
 * One claim lives here: an adapter maps a returned path to a corpus-relative
 * name by file identity, not by string prefix.
 *
 * The index reports the workspace as the operating system canonicalized it,
 * while the harness created it through a name that may be a link (`/var` pointing
 * at `/private/var` on macOS) or a short form (Windows answers `realpath` with the
 * 8.3 name). Comparing the two spellings made every `CodebaseSearch` query look
 * like it found nothing on those two lanes. A symlinked parent reproduces the
 * mismatch on any machine, so the fix is checked where it can be checked.
 */
let real: string;
let linked: string;
let linkParent: string;

beforeAll(() => {
  real = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-eval-spell-real-"));
  linkParent = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-eval-spell-parent-"));
  linked = path.join(linkParent, "workspace");
  fs.mkdirSync(path.join(real, "src"), { recursive: true });
  fs.writeFileSync(path.join(real, "src", "hit.ts"), "export const hit = 1;\n");
  fs.symlinkSync(real, linked, "dir");
});

afterAll(() => {
  fs.rmSync(real, { recursive: true, force: true });
  fs.rmSync(linkParent, { recursive: true, force: true });
});

const expected = { file: "src/hit.ts", startLine: 1, endLine: 1 };

describe("path identity in the adapters", () => {
  it("maps a hit the index spelled through the resolved directory", () => {
    // The harness knows the workspace as `linked`; the answer names the file
    // under `real`. Same file, two prefixes.
    const hits = fromRetrievalHits(linked, [
      { filepath: path.join(real, "src", "hit.ts"), startLine: 1, endLine: 1 },
    ]);

    expect(hits).toEqual([expected]);
  });

  it("maps the other direction too, root resolved and hit through the link", () => {
    // Windows gave one short form and one long form to the two sides in the same
    // way; which side carries which spelling is not knowable in advance.
    const hits = fromRetrievalHits(real, [
      {
        filepath: path.join(linked, "src", "hit.ts"),
        startLine: 1,
        endLine: 1,
      },
    ]);

    expect(hits).toEqual([expected]);
  });

  it("maps a hit the index handed back as a file URI", () => {
    const hits = fromRetrievalHits(linked, [
      {
        filepath: `file://${path.join(real, "src", "hit.ts")}`,
        startLine: 1,
        endLine: 1,
      },
    ]);

    expect(hits).toEqual([expected]);
  });

  it("maps the search output and the file listing the same way", () => {
    const absolute = path.join(real, "src", "hit.ts");

    expect(
      fromSearchOutput(linked, `${absolute}:1:export const hit = 1;`),
    ).toEqual([expected]);
    expect(fromGlobOutput(linked, absolute)).toEqual([{ file: "src/hit.ts" }]);
  });
});
