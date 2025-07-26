import { describe, expect, it } from "vitest";

import { PLAN_MODE_POLICIES } from "./defaultPolicies.js";
import {
  checkToolPermission,
  READ_ONLY_MODE_DENIAL,
} from "./permissionChecker.js";
import { isReadOnlyCommand } from "./readOnlyCommand.js";

describe("isReadOnlyCommand", () => {
  it("accepts commands that only inspect the project", () => {
    const readOnly = [
      "git status",
      "git log --oneline -5",
      "git diff HEAD~1",
      "git branch -a",
      "git remote -v",
      "git config --get user.email",
      "git stash list",
      "git show HEAD",
      "ls -la",
      "cat package.json",
      "rg -n handler src",
      "grep -rn bar .",
      "find src -name '*.ts'",
      "wc -l README.md",
      "head -20 file.txt",
      "tail -5 file.txt",
      "sed -n 1,10p file.txt",
      "sort -u file.txt",
      "jq . package.json",
      "npm ls",
      "npm --version",
      "pnpm outdated",
      "yarn list",
      "CI=1 git status",
      "/usr/bin/git status",
    ];

    for (const command of readOnly) {
      expect(isReadOnlyCommand(command), command).toBe(true);
    }
  });

  it("rejects commands that can write", () => {
    const writers = [
      "rm -rf src",
      "git commit -m x",
      "git push",
      "git checkout main",
      "git branch -D feature",
      "git tag -a v1 -m release",
      "git stash pop",
      "git worktree add ../x",
      "git config user.email a@b.c",
      "npm install",
      "pnpm add lodash",
      "yarn add chalk",
      "chmod +x script.sh",
      "mkdir -p out",
      "sed -i s/a/b/ file.txt",
      "sed -i.bak s/a/b/ file.txt",
      "find . -delete",
      "find . -exec rm {} +",
      "sort -o out.txt file.txt",
      "git diff --output=out.txt",
      "base64 -o out.b64 file.bin",
      "python -c print(1)",
      "node -e console.log(1)",
      "curl https://example.com",
      "sudo ls",
      "bash -c ls",
      "git",
    ];

    for (const command of writers) {
      expect(isReadOnlyCommand(command), command).toBe(false);
    }
  });

  it("rejects anything that reaches a shell operator", () => {
    const chained = [
      "echo hi > out.txt",
      "cat a >> b",
      "cat a | tee b",
      "ls && rm x",
      "ls; rm x",
      "ls $(pwd)",
      "ls `pwd`",
      "git status && git push",
      "cat file &",
    ];

    for (const command of chained) {
      expect(isReadOnlyCommand(command), command).toBe(false);
    }
  });

  it("treats a missing command as unknown rather than safe", () => {
    expect(isReadOnlyCommand(undefined)).toBe(false);
    expect(isReadOnlyCommand(null)).toBe(false);
    expect(isReadOnlyCommand("")).toBe(false);
    expect(isReadOnlyCommand("   ")).toBe(false);
    expect(isReadOnlyCommand("FOO=bar")).toBe(false);
  });
});

describe("read-only mode enforcement", () => {
  const permissions = { policies: PLAN_MODE_POLICIES };

  it("allows inspection commands", () => {
    const result = checkToolPermission(
      { name: "Bash", arguments: { command: "git status" } },
      permissions,
    );

    expect(result.permission).toBe("allow");
  });

  it("refuses commands that can write, with an explanation", () => {
    const result = checkToolPermission(
      { name: "Bash", arguments: { command: "rm -rf src" } },
      permissions,
    );

    expect(result.permission).toBe("exclude");
    expect(result.reason).toBe(READ_ONLY_MODE_DENIAL);
  });

  it("keeps the tool listed while no command has been chosen", () => {
    const result = checkToolPermission(
      { name: "Bash", arguments: {} },
      permissions,
    );

    expect(result.permission).toBe("allow");
  });

  it("still refuses the write tools themselves", () => {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      const result = checkToolPermission(
        { name: tool, arguments: { file_path: "x" } },
        permissions,
      );
      expect(result.permission, tool).toBe("exclude");
    }
  });

  it("leaves read tools and other modes untouched", () => {
    expect(
      checkToolPermission({ name: "Read", arguments: {} }, permissions)
        .permission,
    ).toBe("allow");

    const agentPolicies = {
      policies: [{ tool: "Bash", permission: "ask" as const }],
    };
    expect(
      checkToolPermission(
        { name: "Bash", arguments: { command: "rm -rf src" } },
        agentPolicies,
      ).permission,
    ).toBe("ask");
  });
});
