import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalPath, sameDirectory } from "./canonicalPath.js";

/**
 * A directory has more than one byte spelling on a real machine, and the two callers of
 * this helper meet the spellings at different points: the ACP client names the cwd it was
 * given, the worker asks the kernel, and macOS answers those differently for one directory
 * (`/var` is a link to `/private/var`).
 */
let root: string;
let real: string;
let link: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-canonical-"));
  real = path.join(root, "project");
  link = path.join(root, "opened-as");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, "dir");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("one directory, several spellings", () => {
  it("names a linked directory by what it links to", () => {
    expect(canonicalPath(link)).toBe(canonicalPath(real));
  });

  it("holds two spellings of one directory equal and two directories apart", () => {
    expect(sameDirectory(link, real)).toBe(true);
    expect(sameDirectory(`${real}${path.sep}.`, real)).toBe(true);

    const other = path.join(root, "other");
    fs.mkdirSync(other);
    expect(sameDirectory(other, real)).toBe(false);
  });

  it("keeps a missing path comparable instead of throwing", () => {
    const missing = path.join(real, "gone");
    expect(canonicalPath(missing)).toBe(path.resolve(missing));
    expect(sameDirectory(missing, missing)).toBe(true);
  });
});
