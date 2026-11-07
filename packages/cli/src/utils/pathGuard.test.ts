import * as os from "os";
import * as path from "path";

import { describe, expect, it } from "vitest";

import { assertWithin, resolveWithin } from "./pathGuard.js";

describe("resolveWithin", () => {
  const root = path.join(os.tmpdir(), "tnt-path-guard-root");

  it("passes a normal subpath and returns it resolved against the root", () => {
    expect(resolveWithin(root, "src/a.ts")).toBe(
      path.resolve(root, "src/a.ts"),
    );
    expect(resolveWithin(root, "./src/../b.ts")).toBe(
      path.resolve(root, "b.ts"),
    );
  });

  it("passes the root itself", () => {
    expect(resolveWithin(root, ".")).toBe(path.resolve(root));
    expect(resolveWithin(root, root)).toBe(path.resolve(root));
  });

  it("rejects a .. escape and names the resolved path and the root", () => {
    expect(() => resolveWithin(root, "../escape.txt")).toThrow(
      new RegExp(
        `${path.resolve(root, "../escape.txt")}.*${path.resolve(root)}`,
      ),
    );
    expect(() => resolveWithin(root, "a/../../escape.txt")).toThrow(/outside/);
  });

  it("rejects an absolute path outside the root", () => {
    const outside = path.resolve(os.tmpdir(), "tnt-path-guard-outside");
    expect(() => resolveWithin(root, outside)).toThrow(/outside/);
    expect(() =>
      resolveWithin(root, path.resolve(root, "../sibling.txt")),
    ).toThrow(/outside/);
  });

  it("is a pure string judgment: a not-yet-existing path is judged without the filesystem", () => {
    const missing = path.join(root, "no", "such", "file.txt");
    expect(resolveWithin(root, missing)).toBe(missing);
  });

  // Symbolic-link semantics are intentionally out of scope: the guard never
  // touches the filesystem, so a link inside the root pointing outside it is
  // not caught here. Callers needing that check the result with
  // isWithinWorkspace, which resolves the existing prefix for real.
});

describe("assertWithin", () => {
  it("is the same judgment as resolveWithin", () => {
    const root = path.join(os.tmpdir(), "tnt-path-guard-assert");
    expect(assertWithin(root, "child.txt")).toBe(
      resolveWithin(root, "child.txt"),
    );
    expect(() => assertWithin(root, "../out.txt")).toThrow(/outside/);
  });
});
