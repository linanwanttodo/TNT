import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { astSearchTool } from "./astSearch.js";

/**
 * These cases run the real tree-sitter grammars over a temporary workspace,
 * because the claim being tested is the matcher's, not the wiring's: a shape
 * matches every formatting of that shape, metavariables bind and repeat
 * consistently, and everything the tool could not do is said out loud rather
 * than answered with silence.
 */
describe("the AST search tool", () => {
  let root: string;

  function write(relative: string, content: string): void {
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("test fixture path escaped the fixture root");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-ast-search-"));
    // ripgrep reads .gitignore only inside a repository, so the fixture is one.
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
    write(
      "src/app.ts",
      [
        "export function greet(name) {",
        "  if (name) {",
        '    console.log("hello", name);',
        "  }",
        "  return `hi ${name}`;",
        "}",
        "",
        "const late = console.error;",
        'console.warn("skip");',
        "",
      ].join("\n"),
    );
    write(
      "src/compare.ts",
      ["const same = flag === flag;", "const diff = flag === other;", ""].join(
        "\n",
      ),
    );
    write(
      "src/branch.ts",
      [
        "function check(flag) {",
        "  if (flag) {",
        '    console.log("yes");',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    write(
      "src/twice.ts",
      ['console.log("one");', 'console.log("two");', ""].join("\n"),
    );
    write("node_modules/pkg/index.js", 'console.log("dependency");\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is read-only and names its subject in the preview", async () => {
    expect(astSearchTool.readonly).toBe(true);
    expect(astSearchTool.isBuiltIn).toBe(true);
    const preview = await astSearchTool.preprocess!({ pattern: "a.b($C)" });
    expect(preview.preview?.[0]?.content).toContain("a.b($C)");
  });

  it("asks for a pattern or a kind, and never both", async () => {
    expect(await astSearchTool.run({})).toContain("needs a pattern");
    expect(
      await astSearchTool.run({ pattern: "a.b($C)", kind: "call_expression" }),
    ).toContain("not both");
  });

  it("matches one shape across every formatting, and binds the metavariable", async () => {
    const result = await astSearchTool.run({
      pattern: "console.log($$$A)",
      path: root,
    });

    expect(result).toContain("4 matches");
    expect(result).toContain("src/app.ts:");
    expect(result).toContain('A="hello" name');
    expect(result).toContain("src/twice.ts:");
    expect(result).toContain("src/branch.ts:");
    // Same prefix, different callee: not the shape the pattern names.
    expect(result).not.toContain("console.warn");
    // Dependencies stay out of the answer.
    expect(result).not.toContain("node_modules");
  });

  it("keeps a repeated metavariable honest", async () => {
    const result = await astSearchTool.run({
      pattern: "$A === $A",
      path: root,
    });

    expect(result).toContain("1 match");
    expect(result).toContain("src/compare.ts:1:");
    expect(result).toContain("A=flag");
    expect(result).not.toContain("compare.ts:2:");
  });

  it("matches a statement shape with a body splat", async () => {
    const result = await astSearchTool.run({
      pattern: "if ($A) { $$$B }",
      path: root,
    });

    expect(result).toContain("2 matches");
    expect(result).toContain("A=name");
    expect(result).toContain("A=flag");
    expect(result).toContain("B=console.log");
  });

  it("lists nodes of a kind instead of matching a pattern", async () => {
    const result = await astSearchTool.run({
      kind: "function_declaration",
      path: root,
    });

    expect(result).toContain("2 matches");
    expect(result).toContain("greet");
    expect(result).toContain("check");
  });

  it("stops at the head limit and says so", async () => {
    const result = await astSearchTool.run({
      pattern: "console.log($$$A)",
      path: root,
      head_limit: 1,
    });

    expect(result).toContain("1 match");
    expect(result).toContain("1-match limit");
  });

  it("honours the file pattern when narrowing", async () => {
    const result = await astSearchTool.run({
      pattern: "console.log($$$A)",
      path: root,
      file_pattern: "src/twice.ts",
    });

    expect(result).toContain("2 matches");
    expect(result).not.toContain("src/app.ts:");
  });

  it("reports a pattern the grammar cannot parse instead of matching nothing", async () => {
    const result = await astSearchTool.run({ pattern: "function", path: root });

    expect(result).toContain("0 matches");
    expect(result).toContain("pattern not usable for typescript");
  });

  it("answers no matches plainly when the shape is absent", async () => {
    const result = await astSearchTool.run({
      pattern: "no_such_call($A)",
      path: root,
    });

    expect(result).toContain("0 matches");
    expect(result).not.toContain("pattern not usable");
  });

  it("refuses a path that does not exist", async () => {
    const result = await astSearchTool.run({
      pattern: "a($B)",
      path: path.join(root, "absent"),
    });

    expect(result).toContain("Path does not exist");
  });

  it("keeps a target outside the workspace in front of a human", () => {
    const decide = (args: Record<string, unknown>) =>
      astSearchTool.evaluateToolCallPolicy!("allowedWithoutPermission", args);
    expect(decide({ path: "src" })).toBe("allowedWithoutPermission");
    expect(decide({ path: os.tmpdir() })).toBe("allowedWithPermission");
    expect(decide({})).toBe("allowedWithoutPermission");
    expect(
      astSearchTool.evaluateToolCallPolicy!("disabled", { path: os.tmpdir() }),
    ).toBe("disabled");
  });
});
