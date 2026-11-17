import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  declarationsForFile,
  forgetSymbolIndex,
  isSymbolIndexDisabled,
  lookupLocalSymbols,
} from "./symbolIndex.js";

/**
 * The knowledge layer is only worth trusting if it says exactly what it
 * indexed and where: these cases pin the extraction (what a `name` field
 * counts as, what stays out), the lookup (exact, cross-file), and the
 * invalidation that keeps a stale index from answering.
 */
describe("the local declaration index", () => {
  let root: string;
  let previousKillSwitch: string | undefined;

  function write(relative: string, content: string): void {
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("test fixture path escaped the fixture root");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-symbol-index-"));
    previousKillSwitch = process.env.TNT_SYMBOL_INDEX;
    delete process.env.TNT_SYMBOL_INDEX;
    forgetSymbolIndex(root);
  });

  afterEach(() => {
    if (previousKillSwitch === undefined) {
      delete process.env.TNT_SYMBOL_INDEX;
    } else {
      process.env.TNT_SYMBOL_INDEX = previousKillSwitch;
    }
    forgetSymbolIndex(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("extracts the declarations a grammar names, with 1-based lines", async () => {
    const symbols = await declarationsForFile(
      "sample.ts",
      [
        "export function greet(name) {",
        "  return name;",
        "}",
        "",
        "const later = () => {};",
        "",
        "class Shelf {",
        "  put(item) {}",
        "}",
        "",
        "interface Box { value: string }",
        "type Alias = number;",
        "",
      ].join("\n"),
    );

    const names = symbols?.map((symbol) => symbol.name) ?? [];
    expect(names).toContain("greet");
    expect(names).toContain("later");
    expect(names).toContain("Shelf");
    expect(names).toContain("put");
    expect(names).toContain("Box");
    expect(names).toContain("Alias");

    const greet = symbols?.find((symbol) => symbol.name === "greet");
    expect(greet?.kind).toBe("function_declaration");
    expect(greet?.line).toBe(1);
  });

  it("leaves parameters and object keys out of the index", async () => {
    const symbols = await declarationsForFile(
      "sample.ts",
      [
        'const options = { key: "value" };',
        "",
        "function greet(first, second) {",
        "  return first;",
        "}",
        "",
      ].join("\n"),
    );

    const names = symbols?.map((symbol) => symbol.name) ?? [];
    expect(names).toContain("greet");
    expect(names).toContain("options");
    expect(names).not.toContain("first");
    expect(names).not.toContain("second");
    expect(names).not.toContain("key");
  });

  it("keeps the index to file scope and class members, not locals", async () => {
    const symbols = await declarationsForFile(
      "sample.ts",
      [
        "function greet() {",
        "  const local = 1;",
        "  return local;",
        "}",
        "",
      ].join("\n"),
    );

    const names = symbols?.map((symbol) => symbol.name) ?? [];
    expect(names).toContain("greet");
    // A local binding inside a function body is not a declaration the
    // workspace index answers for; a name search finds it instead.
    expect(names).not.toContain("local");
  });

  it("answers a lookup from every file that declares the name", async () => {
    write(
      "src/one.ts",
      ["export function helper() {", "  return 1;", "}", ""].join("\n"),
    );
    write("src/two.py", ["def helper():", "    return 2", ""].join("\n"));
    write("src/notes.md", "# helper is not code\n");

    const hits = await lookupLocalSymbols(root, "helper");

    expect(hits).toHaveLength(2);
    expect(hits?.map((hit) => hit.path).sort()).toEqual([
      "src/one.ts",
      "src/two.py",
    ]);
    expect(hits?.every((hit) => hit.line === 1)).toBe(true);
  });

  it("answers a miss with an empty list, and honours the kill switch", async () => {
    write("src/one.ts", "export function helper() {}\n");

    expect(await lookupLocalSymbols(root, "nowhere")).toEqual([]);

    process.env.TNT_SYMBOL_INDEX = "0";
    expect(isSymbolIndexDisabled()).toBe(true);
    expect(await lookupLocalSymbols(root, "helper")).toBeUndefined();
  });

  it("rebuilds when an indexed file changes", async () => {
    write("src/one.ts", "export function helper() {}\n");
    expect(await lookupLocalSymbols(root, "helper")).toHaveLength(1);

    write("src/one.ts", "export function renamed() {}\n");
    forgetSymbolIndex(root);

    expect(await lookupLocalSymbols(root, "helper")).toEqual([]);
    expect(await lookupLocalSymbols(root, "renamed")).toHaveLength(1);
  });
});
