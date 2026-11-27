import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sessionApprovalKey } from "../permissions/sessionApprovals.js";
import {
  isWithinWorkspace,
  workspaceRoot as permissionRoot,
} from "../permissions/workspacePath.js";
import { runInWorkspaceScope } from "../utils/workspaceScope.js";

import { astSearchTool } from "./astSearch.js";
import { globFilesTool } from "./globFiles.js";
import { importGraphTool } from "./importGraph.js";
import { listFilesTool } from "./listFiles.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { searchCodeTool } from "./searchCode.js";
import { writeFileTool } from "./writeFile.js";

let root: string;
let worktree: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-workspace-main-"));
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-workspace-child-"));
  fs.writeFileSync(path.join(root, "main-only.txt"), "main secret\n");
  fs.writeFileSync(path.join(worktree, "child-only.txt"), "child needle\n");
  fs.writeFileSync(path.join(root, "main.js"), "mainOnly()\n");
  fs.writeFileSync(path.join(worktree, "child.js"), "childOnly()\n");
  fs.writeFileSync(path.join(root, "main-a.ts"), 'import "./main-b";\n');
  fs.writeFileSync(path.join(root, "main-b.ts"), "export const main = 1;\n");
  fs.writeFileSync(path.join(worktree, "child-a.ts"), 'import "./child-b";\n');
  fs.writeFileSync(
    path.join(worktree, "child-b.ts"),
    "export const child = 1;\n",
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(worktree, { recursive: true, force: true });
});

describe("tools in an isolated workspace", () => {
  it("resolves permissions, listing, search, shell and writes against the child root", async () => {
    await runInWorkspaceScope(worktree, async () => {
      expect(permissionRoot()).toBe(worktree);
      expect(isWithinWorkspace(".")).toBe(true);
      expect(isWithinWorkspace("child-only.txt")).toBe(true);
      expect(isWithinWorkspace(path.join(root, "main-only.txt"))).toBe(false);
      expect(sessionApprovalKey("Bash", { command: "pwd" })).toBe(
        `Bash(${worktree}::pwd)`,
      );
      expect(sessionApprovalKey("Write", { filepath: "new.txt" })).toBe(
        `Write(${path.join(worktree, "new.txt")})`,
      );
      const listed = await listFilesTool.preprocess!({});
      expect(listed.args.dirpath).toBe(worktree);

      const found = await searchCodeTool.run({ pattern: "needle", path: "." });
      expect(found).toContain("child-only.txt");
      expect(found).not.toContain("main-only.txt");

      const globbed = await globFilesTool.run({ pattern: "*.txt", path: "." });
      expect(globbed).toContain("child-only.txt");
      expect(globbed).not.toContain("main-only.txt");

      const structural = await astSearchTool.run({
        pattern: "childOnly()",
        path: ".",
      });
      expect(structural).toContain("child.js");
      expect(structural).not.toContain("main.js");

      const graph = await importGraphTool.run({
        action: "dependencies",
        file_path: "child-a.ts",
      });
      expect(graph).toContain("child-b.ts");
      expect(graph).not.toContain("main-b.ts");

      const pwd = await runTerminalCommandTool.run({ command: "pwd" });
      expect((typeof pwd === "string" ? pwd : pwd.content).trim()).toBe(
        worktree,
      );

      await writeFileTool.run({ filepath: "new.txt", content: "child write" });
      expect(fs.readFileSync(path.join(worktree, "new.txt"), "utf8")).toBe(
        "child write",
      );
      expect(fs.existsSync(path.join(root, "new.txt"))).toBe(false);
    });
  });
});
