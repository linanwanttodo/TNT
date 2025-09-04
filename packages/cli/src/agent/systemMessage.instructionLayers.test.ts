import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The adjacent hand-written mock would replace the builder wholesale.
vi.unmock("./systemMessage.js");
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn().mockResolvedValue({ config: { rules: [] } }),
    set: vi.fn(),
  },
}));
vi.mock("../config/hubLoader.js", () => ({
  processRule: vi
    .fn()
    .mockImplementation((spec: string) => Promise.resolve(spec)),
}));

const {
  RULES_PREAMBLE,
  constructSystemMessage,
  loadMarkdownRulesWithMetadata,
} = await import("./systemMessage.js");

describe("instruction layers", () => {
  let dir = "";
  let previous = "";

  const write = (relative: string, content: string): void => {
    const filePath = path.join(dir, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-layers-"));
    previous = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads the committed file, the local file and the rule files", async () => {
    write("AGENTS.md", "PROJECT_RULE @docs/testing.md");
    write("docs/testing.md", "INCLUDED_TESTING_RULE");
    write("AGENTS.local.md", "LOCAL_RULE");
    write(
      ".tnt/rules/style.md",
      "---\nalwaysApply: true\n---\nMARKDOWN_RULE @style-extra.md\n",
    );
    write(".tnt/rules/style-extra.md", "INCLUDED_STYLE_RULE");

    const message = await constructSystemMessage("agent", [], undefined);

    expect(message).toContain(RULES_PREAMBLE);
    expect(message).toContain("PROJECT_RULE INCLUDED_TESTING_RULE");
    expect(message).toContain("Rules from AGENTS.md");
    expect(message).toContain("LOCAL_RULE");
    expect(message).toContain("not committed");
    expect(message).toContain("MARKDOWN_RULE INCLUDED_STYLE_RULE");

    const preamble = message.indexOf(RULES_PREAMBLE);
    const project = message.indexOf("PROJECT_RULE");
    const local = message.indexOf("LOCAL_RULE");
    expect(preamble).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(preamble);
    expect(local).toBeGreaterThan(project);
  });

  it("starts the rules block with what the block is for", async () => {
    write("AGENTS.md", "ONLY_RULE");

    const message = await constructSystemMessage("agent", [], undefined);
    const block = message.slice(message.indexOf('<context name="userRules">'));

    expect(block.startsWith('<context name="userRules">')).toBe(true);
    expect(block.indexOf(RULES_PREAMBLE)).toBeLessThan(
      block.indexOf("ONLY_RULE"),
    );
  });

  it("invents no layer when the project has no instruction file", async () => {
    const message = await constructSystemMessage("agent", [], undefined);

    expect(message).not.toContain("Rules from");
    expect(message).not.toContain("[Includes:");
  });

  it("reads the managed tier before the project's, in listed order", () => {
    const managed = path.join(dir, "managed-rules");
    write("managed-rules/z-last.md", "ZED_MANAGED_RULE");
    write("managed-rules/a-first.md", "ABC_MANAGED_RULE");
    write("managed-rules/nested/deep.md", "NESTED_MANAGED_RULE");
    write(".tnt/rules/project.md", "PROJECT_RULE");

    const previous = process.env.CONTINUE_CLI_MANAGED_RULES_DIR;
    process.env.CONTINUE_CLI_MANAGED_RULES_DIR = managed;
    try {
      const bodies = loadMarkdownRulesWithMetadata().map((rule) =>
        rule.rule.trim(),
      );
      const at = (body: string): number => bodies.indexOf(body);

      expect(at("ABC_MANAGED_RULE")).toBeGreaterThan(-1);
      expect(at("NESTED_MANAGED_RULE")).toBeGreaterThan(-1);
      expect(at("ABC_MANAGED_RULE")).toBeLessThan(at("ZED_MANAGED_RULE"));
      expect(at("ZED_MANAGED_RULE")).toBeLessThan(at("PROJECT_RULE"));
    } finally {
      if (previous === undefined) {
        delete process.env.CONTINUE_CLI_MANAGED_RULES_DIR;
      } else {
        process.env.CONTINUE_CLI_MANAGED_RULES_DIR = previous;
      }
    }
  });
});
