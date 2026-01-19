import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractSpecifiers,
  ImportGraphService,
  resolveImportTarget,
} from "./importGraph.js";

describe("extracting module specifiers", () => {
  it("reads static, side-effect, re-export, require and dynamic imports", () => {
    const text = [
      'import { a } from "./a";',
      'import "./side-effect";',
      'export * from "../shared";',
      'const c = require("./c");',
      'const d = await import("./d");',
    ].join("\n");

    expect(extractSpecifiers(text, "typescript")).toEqual([
      { specifier: "./a", kind: "typescript" },
      { specifier: "./side-effect", kind: "typescript" },
      { specifier: "../shared", kind: "typescript" },
      { specifier: "./c", kind: "typescript" },
      { specifier: "./d", kind: "typescript" },
    ]);
  });

  it("reads multiline imports without swallowing the next statement", () => {
    const text = 'import {\n  a,\n  b,\n} from "./ab";\nconst x = 1;';

    expect(extractSpecifiers(text, "typescript")).toEqual([
      { specifier: "./ab", kind: "typescript" },
    ]);
  });

  it("reads python from/import lines", () => {
    const text = "from .models import User\nimport os, a.b as c\n";

    expect(extractSpecifiers(text, "python")).toEqual([
      { specifier: ".models", kind: "python" },
      { specifier: "os", kind: "python" },
      { specifier: "a.b", kind: "python" },
    ]);
  });

  it("reads go single and block imports", () => {
    const text = [
      'import "fmt"',
      "import (",
      '  "os"',
      '  alias "example.com/x"',
      ")",
    ].join("\n");

    expect(extractSpecifiers(text, "go")).toEqual([
      { specifier: "fmt", kind: "go" },
      { specifier: "os", kind: "go" },
      { specifier: "example.com/x", kind: "go" },
    ]);
  });

  it("reads java, rust and include lines", () => {
    expect(
      extractSpecifiers("import static a.b.C;\nimport a.b.D;", "java"),
    ).toEqual([
      { specifier: "a.b.C", kind: "java" },
      { specifier: "a.b.D", kind: "java" },
    ]);
    expect(extractSpecifiers("use crate::a::b;\n", "rust")).toEqual([
      { specifier: "crate::a::b", kind: "rust" },
    ]);
    expect(
      extractSpecifiers('#include "local.h"\n#include <stdio.h>', "cpp"),
    ).toEqual([
      { specifier: "local.h", kind: "cpp" },
      { specifier: "stdio.h", kind: "cpp" },
    ]);
  });

  it("ignores imports that only appear mid-line", () => {
    const text = 'const s = "import x from y";\n// import { z } from "z";';

    expect(extractSpecifiers(text, "typescript")).toEqual([]);
  });
});

describe("resolving a specifier to a workspace file", () => {
  const files = new Set([
    "src/b.ts",
    "src/lib/index.ts",
    "src/local.h",
    "pkg/models.py",
    "pkg/__init__.py",
  ]);
  const exists = (relative: string) => files.has(relative);

  it("resolves relative imports and index files", () => {
    expect(resolveImportTarget("src/a.ts", "./b", "typescript", exists)).toBe(
      "src/b.ts",
    );
    expect(resolveImportTarget("src/a.ts", "./lib", "typescript", exists)).toBe(
      "src/lib/index.ts",
    );
  });

  it("maps a .js specifier onto the TypeScript source", () => {
    expect(
      resolveImportTarget("src/a.ts", "./b.js", "typescript", exists),
    ).toBe("src/b.ts");
  });

  it("leaves a bare package import unresolved", () => {
    expect(resolveImportTarget("src/a.ts", "react", "typescript", exists)).toBe(
      null,
    );
  });

  it("resolves python relative and absolute modules", () => {
    expect(resolveImportTarget("pkg/a.py", ".models", "python", exists)).toBe(
      "pkg/models.py",
    );
    expect(
      resolveImportTarget("pkg/a.py", "pkg.models", "python", exists),
    ).toBe("pkg/models.py");
  });

  it("resolves a quoted include relative to the file", () => {
    expect(resolveImportTarget("src/a.cpp", "local.h", "cpp", exists)).toBe(
      "src/local.h",
    );
  });
});

let workspace: string;
let store: string;
let storeDir: string;

function write(relative: string, content: string): void {
  const target = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-import-graph-"));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-import-store-"));
  store = path.join(storeDir, "imports.json");
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("the persisted import graph", () => {
  it("indexes edges, answers both directions, and walks to a depth", async () => {
    write("src/a.ts", 'import { b } from "./b";\n');
    write("src/b.ts", "export const b = 1;\n");
    write("src/c.ts", 'import { a } from "./a";\n');
    write("src/d.ts", 'import { c } from "./c";\n');

    const service = new ImportGraphService(workspace, store);
    const refreshed = await service.refresh();

    expect(refreshed.files).toBe(4);
    expect(await service.dependencies("src/a.ts")).toEqual([
      { path: "src/b.ts", depth: 1, via: "./b" },
    ]);
    expect(await service.dependents("src/b.ts")).toEqual([
      { path: "src/a.ts", depth: 1, via: "./b" },
    ]);
    expect(await service.dependents("src/a.ts", 2)).toEqual([
      { path: "src/c.ts", depth: 1, via: "./a" },
      { path: "src/d.ts", depth: 2, via: "./c" },
    ]);
  });

  it("re-parses only changed files and drops deleted ones", async () => {
    write("src/a.ts", 'import { b } from "./b";\n');
    write("src/b.ts", "export const b = 1;\n");
    write("src/d.ts", "import './a';\n");

    const service = new ImportGraphService(workspace, store);
    await service.refresh();

    write("src/a.ts", 'import { d } from "./d";\n');
    const second = await service.refresh();
    expect(second.parsed).toBe(1);
    expect(await service.dependencies("src/a.ts")).toEqual([
      { path: "src/d.ts", depth: 1, via: "./d" },
    ]);

    fs.rmSync(path.join(workspace, "src/d.ts"));
    await service.refresh();
    expect(await service.dependencies("src/a.ts")).toEqual([]);
  });

  it("reads the graph back from disk in a new process-shaped instance", async () => {
    write("src/a.ts", 'import { b } from "./b";\n');
    write("src/b.ts", "export const b = 1;\n");

    await new ImportGraphService(workspace, store).refresh();

    const reloaded = new ImportGraphService(workspace, store);
    expect(await reloaded.dependencies("src/a.ts")).toEqual([
      { path: "src/b.ts", depth: 1, via: "./b" },
    ]);
  });
});
