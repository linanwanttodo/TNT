import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  forgetRepoMap,
  inventoryFingerprint,
  inventoryWorkspace,
  isLargeWorkspace,
  localRepoMap,
  renderRepoMap,
} from "./repoMap.js";

let root: string;
let previousGlobalDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-repo-map-"));
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  process.env.TNT_GLOBAL_DIR = path.join(root, "state");
  forgetRepoMap(root);
});

afterEach(() => {
  if (previousGlobalDir === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobalDir;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function writeFile(relative: string, content = "x"): void {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("test fixture path escaped the fixture root");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe("inventoryWorkspace", () => {
  it("skips dependency and build directories, and stays relative", () => {
    writeFile("README.md", "hello");
    writeFile("src/main.ts", "package main");
    writeFile("node_modules/pkg/index.js", "ignored");
    writeFile("dist/bundle.js", "ignored");

    const paths = inventoryWorkspace(root).map((entry) => entry.path);
    expect(paths).toEqual(["README.md", "src/main.ts"]);
  });

  it("changes the fingerprint when a file is touched, and only then", () => {
    writeFile("src/a.ts");
    const first = inventoryFingerprint(inventoryWorkspace(root));
    expect(inventoryFingerprint(inventoryWorkspace(root))).toBe(first);
    writeFile("src/a.ts", "a longer content so size changes");
    expect(inventoryFingerprint(inventoryWorkspace(root))).not.toBe(first);
  });
});

describe("renderRepoMap", () => {
  it("names entry points and directory shapes without file contents", () => {
    writeFile("README.md");
    writeFile("package.json", "{}");
    writeFile("src/index.ts");
    const map = renderRepoMap(root, inventoryWorkspace(root));
    expect(map).toContain("Entry points: README.md, package.json");
    expect(map).toContain("src/ 1 files: index.ts");
    expect(map).not.toContain("package main");
  });
});

describe("localRepoMap", () => {
  it("builds once, then reads the cache until the inventory changes", () => {
    writeFile("src/index.ts");
    const first = localRepoMap(root);
    expect(first.rebuilt).toBe(true);
    expect(first.map).toContain("Workspace:");
    const cached = localRepoMap(root);
    expect(cached.rebuilt).toBe(false);
    expect(cached.map).toBe(first.map);
    writeFile("src/new.ts");
    const rebuilt = localRepoMap(root);
    expect(rebuilt.rebuilt).toBe(true);
    expect(rebuilt.map).toContain("new.ts");
  });

  it("still returns a map when the state directory cannot be written", () => {
    writeFile("src/index.ts");
    process.env.TNT_GLOBAL_DIR = path.join(root, "src", "index.ts");
    expect(localRepoMap(root).map).toContain("Workspace:");
  });
});

describe("isLargeWorkspace", () => {
  it("is false for a handful of files", () => {
    writeFile("README.md");
    expect(isLargeWorkspace(root)).toBe(false);
  });

  it("is true past the threshold", () => {
    for (let i = 0; i < 210; i += 1) {
      writeFile(`src/f${i}.ts`);
    }
    expect(isLargeWorkspace(root)).toBe(true);
  });
});
