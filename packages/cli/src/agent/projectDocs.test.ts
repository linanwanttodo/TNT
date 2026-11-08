import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROJECT_DOC_SEPARATOR,
  loadProjectDocs,
  projectRoot,
} from "./projectDocs.js";

const roots: string[] = [];

function project(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-project-"));
  roots.push(directory);
  fs.mkdirSync(path.join(directory, ".git"), { recursive: true });
  return directory;
}

function write(root: string, relative: string, content: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const directory of roots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("project instruction discovery", () => {
  it("reads every directory from the project root down to the working directory", () => {
    const root = project();
    write(root, "AGENTS.md", "ROOT_RULE");
    write(root, "packages/cli/AGENTS.md", "PACKAGE_RULE");
    write(root, "packages/cli/src/CLAUDE.md", "DEEP_RULE");

    const docs = loadProjectDocs(path.join(root, "packages", "cli", "src"));

    expect(docs.map((doc) => doc.label)).toEqual([
      "AGENTS.md",
      "packages/cli/AGENTS.md",
      "packages/cli/src/CLAUDE.md",
    ]);
    const text = docs.map((doc) => doc.text).join("\n");
    expect(text.indexOf("ROOT_RULE")).toBeLessThan(
      text.indexOf("PACKAGE_RULE"),
    );
    expect(text.indexOf("PACKAGE_RULE")).toBeLessThan(
      text.indexOf("DEEP_RULE"),
    );
    // The separator announces where one project document ends and the next
    // begins, so the model does not read nested files as one text.
    expect(docs[1].text.startsWith(PROJECT_DOC_SEPARATOR)).toBe(true);
    expect(docs[0].text).not.toContain(PROJECT_DOC_SEPARATOR);
  });

  it("prefers AGENTS.override.md in the directory that has one", () => {
    const root = project();
    write(root, "AGENTS.md", "BASE_RULE");
    write(root, "AGENTS.override.md", "OVERRIDE_RULE");
    write(root, "sub/AGENTS.md", "SUBDIR_RULE");

    const docs = loadProjectDocs(path.join(root, "sub"));

    expect(docs[0].label).toBe("AGENTS.override.md");
    expect(docs[0].text).toContain("OVERRIDE_RULE");
    expect(docs[0].text).not.toContain("BASE_RULE");
    // The override is per directory, so it does not suppress a deeper file.
    expect(docs[1].label).toBe("sub/AGENTS.md");
  });

  it("prefers AGENTS.md over the TNT name, and still reads the TNT name without one", () => {
    const root = project();
    write(root, ".tnt/AGENTS.md", "TNT_RULE");
    write(root, "AGENTS.md", "PLAIN_RULE");

    expect(loadProjectDocs(root)[0].text).toContain("PLAIN_RULE");
    expect(loadProjectDocs(root)[0].text).not.toContain("TNT_RULE");

    const fallback = project();
    write(fallback, ".tnt/AGENTS.md", "TNT_FALLBACK_RULE");
    write(fallback, "CLAUDE.md", "CLAUDE_RULE");

    expect(loadProjectDocs(fallback)[0].text).toContain("TNT_FALLBACK_RULE");
  });

  it("ignores an instruction file above the project root marker", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-outer-"));
    roots.push(outer);
    write(outer, "AGENTS.md", "ABOVE_ROOT_RULE");
    const root = path.join(outer, "project");
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    write(root, "sub/AGENTS.md", "PROJECT_RULE");

    expect(projectRoot(path.join(root, "sub"))).toBe(root);
    const text = loadProjectDocs(path.join(root, "sub"))
      .map((doc) => doc.text)
      .join("\n");

    expect(text).toContain("PROJECT_RULE");
    expect(text).not.toContain("ABOVE_ROOT_RULE");
  });

  it("treats a checkout without a marker as a project of one directory", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-nogit-"));
    roots.push(directory);
    write(directory, "AGENTS.md", "LOCAL_RULE");

    expect(projectRoot(directory)).toBe(directory);
    expect(loadProjectDocs(directory).map((doc) => doc.label)).toEqual([
      "AGENTS.md",
    ]);
  });

  it("bounds the concatenation and says where it stopped", () => {
    const root = project();
    write(root, "AGENTS.md", "A".repeat(400));
    write(root, "sub/AGENTS.md", "LATER_RULE");

    const docs = loadProjectDocs(path.join(root, "sub"), 120);

    expect(docs).toHaveLength(1);
    expect(docs[0].text).toContain("[Truncated: project instructions stop at");
    expect(docs[0].text).not.toContain("LATER_RULE");
    expect(docs[0].text).toContain("A".repeat(20));
  });

  it("expands includes before applying the budget", () => {
    const root = project();
    write(root, "AGENTS.md", "HEAD @extra.md");
    write(root, "extra.md", "INCLUDED_RULE");

    expect(loadProjectDocs(root)[0].text).toContain("HEAD INCLUDED_RULE");
  });
});
