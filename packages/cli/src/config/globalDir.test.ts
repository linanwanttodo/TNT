import { afterEach, describe, expect, it } from "vitest";

import { globalDir, globalDirOverride } from "./globalDir.js";

const previous = {
  tnt: process.env.TNT_GLOBAL_DIR,
  continue: process.env.CONTINUE_GLOBAL_DIR,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    TNT_GLOBAL_DIR: previous.tnt,
    CONTINUE_GLOBAL_DIR: previous.continue,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the global directory", () => {
  it("prefers the TNT name", () => {
    process.env.TNT_GLOBAL_DIR = "/home/lin/.tnt-new";
    process.env.CONTINUE_GLOBAL_DIR = "/home/lin/.tnt-old";
    expect(globalDirOverride()).toBe("/home/lin/.tnt-new");
    expect(globalDir("/home/lin")).toBe("/home/lin/.tnt-new");
  });

  it("still honors the name users already have set", () => {
    // Dropping this would not print an error: the affected runs would simply
    // start with an empty home and lose their settings and sessions.
    delete process.env.TNT_GLOBAL_DIR;
    process.env.CONTINUE_GLOBAL_DIR = "/home/lin/.tnt-old";
    expect(globalDir("/home/lin")).toBe("/home/lin/.tnt-old");
  });

  it("falls back to the home directory under the given root", () => {
    delete process.env.TNT_GLOBAL_DIR;
    delete process.env.CONTINUE_GLOBAL_DIR;
    expect(globalDir("/home/lin")).toBe("/home/lin/.tnt");
  });
});
