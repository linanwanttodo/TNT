import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { globalDir, globalDirOverride } from "./globalDir.js";

const previous = {
  tnt: process.env.TNT_GLOBAL_DIR,
  retired: process.env.CONTINUE_GLOBAL_DIR,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    TNT_GLOBAL_DIR: previous.tnt,
    CONTINUE_GLOBAL_DIR: previous.retired,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the global directory", () => {
  it("follows the documented name", () => {
    process.env.TNT_GLOBAL_DIR = "/home/lin/.tnt-new";
    expect(globalDirOverride()).toBe("/home/lin/.tnt-new");
    expect(globalDir("/home/lin")).toBe("/home/lin/.tnt-new");
  });

  it("does not read the retired spelling", () => {
    // The rename shipped without a compatibility read, so a stale
    // `CONTINUE_GLOBAL_DIR` in someone's shell must not silently relocate the
    // home directory. Reading it again would be the shim this project decided
    // against - the assertion fails the moment the fallback returns.
    delete process.env.TNT_GLOBAL_DIR;
    process.env.CONTINUE_GLOBAL_DIR = "/home/lin/.tnt-old";
    expect(globalDir("/home/lin")).toBe(path.join("/home/lin", ".tnt"));
  });

  it("falls back to the home directory under the given root", () => {
    delete process.env.TNT_GLOBAL_DIR;
    delete process.env.CONTINUE_GLOBAL_DIR;
    // Built the way the implementation builds it. The literal `"/home/lin/.tnt"`
    // matched on Linux and macOS only: `path.join` answers `\home\lin\.tnt` on
    // Windows, so the assertion was pinning a separator, not the layout.
    expect(globalDir("/home/lin")).toBe(path.join("/home/lin", ".tnt"));
  });
});
