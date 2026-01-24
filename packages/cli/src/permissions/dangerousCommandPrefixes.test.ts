import { describe, expect, it } from "vitest";

import {
  DANGEROUS_ALLOW_PREFIXES,
  hasDangerousAllowPrefix,
} from "./dangerousCommandPrefixes.js";

describe("dangerous allow prefixes", () => {
  it("reads a table a class test can be wrong about", () => {
    // Floor: an empty table would make every refusal test below fail for the
    // wrong reason, and every allow test pass for the wrong reason.
    expect(DANGEROUS_ALLOW_PREFIXES.length).toBeGreaterThanOrEqual(25);
  });

  const dangerous = [
    ["python3 -c 'print(1)'", "python3"],
    ["node -e 'process.exit(0)'", "node"],
    ["deno run mod.ts", "deno"],
    ["tsx script.ts", "tsx"],
    ["ruby -e 'puts 1'", "ruby"],
    ["perl -e 'print 1'", "perl"],
    ["php -r 'echo 1;'", "php"],
    ["Rscript analysis.R", "Rscript"],
    ["npx some-cli", "npx"],
    ["bunx some-cli", "bunx"],
    ["pnpm dlx some-cli", "pnpm dlx"],
    ["yarn dlx some-cli", "yarn dlx"],
    ["pipx run tool", "pipx run"],
    ["uvx tool", "uvx"],
    ["npm run postinstall", "npm run"],
    ["pnpm run build", "pnpm run"],
    ["yarn run build", "yarn run"],
    ["bun run build", "bun run"],
    ["bash -lc 'ls'", "bash"],
    ["sh -c 'ls'", "sh"],
    ["zsh -c 'ls'", "zsh"],
    ["fish -c 'ls'", "fish"],
    ["powershell -Command ls", "powershell"],
    ["pwsh -c ls", "pwsh"],
    ["eval 'ls'", "eval"],
    ["exec bash", "exec"],
    ["env FOO=1 python3 tool.py", "env"],
    ["xargs rm", "xargs"],
    ["nohup server", "nohup"],
    ["timeout 5 npm test", "timeout"],
    ["watch ls", "watch"],
    ["busybox sh", "busybox"],
    ["sudo ls", "sudo"],
    ["su -c ls", "su"],
    ["ssh host ls", "ssh"],
    ["scp file host:", "scp"],
    ["rsync -a src/ host:", "rsync"],
    ["curl https://example.com", "curl"],
    ["wget https://example.com/file", "wget"],
    ["nc host 22", "nc"],
  ];

  it.each(dangerous)("flags %s", (command) => {
    expect(hasDangerousAllowPrefix(command)).toBe(true);
  });

  it("tells a runner apart from the package manager it comes from", () => {
    expect(hasDangerousAllowPrefix("npm install pkg")).toBe(false);
    expect(hasDangerousAllowPrefix("pnpm install")).toBe(false);
    expect(hasDangerousAllowPrefix("su")).toBe(true);
    expect(hasDangerousAllowPrefix("sudo ls")).toBe(true);
  });

  it("keeps ordinary development commands alone", () => {
    for (const command of [
      "ls -la",
      "git status",
      "git commit -m 'test'",
      "npm install pkg",
      "npm test",
      "make test",
      "rm file.txt",
      "echo hello",
    ]) {
      expect(hasDangerousAllowPrefix(command), command).toBe(false);
    }
  });

  it("looks past environment assignments and a directory prefix", () => {
    expect(hasDangerousAllowPrefix("FOO=1 BAR=2 python3 tool.py")).toBe(true);
    expect(hasDangerousAllowPrefix("/usr/bin/python3 tool.py")).toBe(true);
    expect(hasDangerousAllowPrefix("C:\\\\Python\\\\python.exe tool.py")).toBe(
      true,
    );
    expect(hasDangerousAllowPrefix('"python3" tool.py')).toBe(true);
    expect(hasDangerousAllowPrefix("FOO=1 BAR=2")).toBe(false);
  });

  it("judges every command a chain or a line break puts on one call", () => {
    expect(hasDangerousAllowPrefix("ls && python3 tool.py")).toBe(true);
    expect(hasDangerousAllowPrefix("echo hi | bash")).toBe(true);
    expect(hasDangerousAllowPrefix("ls; node tool.js")).toBe(true);
    expect(hasDangerousAllowPrefix("ls\npython3 tool.py")).toBe(true);
    expect(hasDangerousAllowPrefix("ls && pwd")).toBe(false);
  });

  it("treats a missing or empty command as nothing to judge", () => {
    expect(hasDangerousAllowPrefix(undefined)).toBe(false);
    expect(hasDangerousAllowPrefix(null)).toBe(false);
    expect(hasDangerousAllowPrefix("")).toBe(false);
    expect(hasDangerousAllowPrefix("   ")).toBe(false);
  });
});
