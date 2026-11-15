import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IDE } from "../..";
import { listMarkdownSkills } from "./loadMarkdownSkills";

// Verifies the skills listing the settings page depends on, against real
// files on disk. The IDE is stubbed with the small surface loading needs.
describe("listMarkdownSkills", () => {
  function makeWorkspace() {
    const root = mkdtempSync(path.join(tmpdir(), "skills-"));
    const skillDir = path.join(root, ".claude", "skills", "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: A test skill",
        "---",
        "",
        "# My Skill",
        "",
        "Instructions here.",
      ].join("\n"),
    );
    writeFileSync(path.join(skillDir, "helper.txt"), "bundled file");
    return root;
  }

  function makeIde(root: string): IDE {
    const dirUri = `file://${root}`;
    return {
      getWorkspaceDirs: async () => [dirUri],
      fileExists: async (uri: string) => {
        // Report every path under the workspace as existing so walkDir can
        // enumerate the tree the way a real IDE would.
        return uri.startsWith(dirUri);
      },
      readFile: async (uri: string) => {
        const fs = await import("node:fs/promises");
        return fs.readFile(uri.replace("file://", ""), "utf8");
      },
      listDir: async (dirUri: string) => {
        const fs = await import("node:fs/promises");
        const dir = dirUri.replace("file://", "");
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.map((e) => [
          e.name,
          e.isDirectory() ? 2 : 1, // FileType: File = 1, Directory = 2
        ]) as [string, any][];
      },
      getUriForFile: async (p: string) => `file://${p}`,
      getWorkspaceConfig: async () => null,
      subprocess: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    } as unknown as IDE;
  }

  it("lists a skill with its metadata, files and scope", async () => {
    const root = makeWorkspace();
    const { skills, errors } = await listMarkdownSkills(makeIde(root));

    expect(errors).toEqual([]);
    const skill = skills.find((s) => s.name === "my-skill");
    expect(skill).toBeDefined();
    expect(skill?.description).toBe("A test skill");
    expect(skill?.scope).toBe("workspace");
    expect(skill?.uri.endsWith("SKILL.md")).toBe(true);
    expect(skill?.files.some((f) => f.includes("helper.txt"))).toBe(true);
  });
});
