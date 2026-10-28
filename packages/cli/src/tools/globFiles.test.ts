import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ripgrep = vi.hoisted(() => ({ installed: true }));

vi.mock("./searchCode.js", () => ({
  checkIfRipgrepIsInstalled: async () => ripgrep.installed,
}));

import { globFilesTool } from "./globFiles.js";

let dir: string;
const previousCwd = process.cwd();

function write(relative: string, content = "x"): void {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

async function run(args: Record<string, unknown>): Promise<string> {
  return (await globFilesTool.run!(args)) as string;
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tnt-glob-")));
  // ripgrep only reads .gitignore inside a repository, so the fixture is one.
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  // No `path` argument means "where the run is", so the test has to be there too.
  process.chdir(dir);
  ripgrep.installed = true;
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTINUE_CLI_GLOB_MAX_RESULTS;
});

describe("Glob", () => {
  it("finds a file by name at any depth", async () => {
    write("src/deep/nested/widget.ts");
    write("README.md");

    const output = await run({ pattern: "**/*.ts" });

    expect(output).toContain(path.join("src", "deep", "nested", "widget.ts"));
    expect(output).not.toContain("README.md");
  });

  it("anchors a relative pattern at the path it was given, not at the run", async () => {
    write(path.join("src", "billing", "refund.ts"));
    write(path.join("src", "orders", "order.ts"));

    // A search of another directory arrives as an absolute `path` plus a pattern
    // written against that directory, while the process sits somewhere else.
    // Ripgrep anchors a slash-bearing glob at the working directory, so the
    // filter matched nothing and the answer was "no files match".
    const elsewhere = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "tnt-glob-elsewhere-")),
    );
    process.chdir(elsewhere);
    try {
      const output = await run({
        pattern: "src/billing/*.ts",
        path: dir,
      });

      expect(output).toContain(path.join("src", "billing", "refund.ts"));
      expect(output).not.toContain("order.ts");
    } finally {
      process.chdir(dir);
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("skips what the repository ignores", async () => {
    write(".gitignore", "generated/\n");
    write("src/keep.ts");
    write("generated/skip.ts");

    const output = await run({ pattern: "**/*.ts" });

    expect(output).toContain("keep.ts");
    expect(output).not.toContain("skip.ts");
  });

  it("puts the newest file first", async () => {
    // Named so that a plain alphabetical sort would answer in the opposite order
    // - otherwise this case would pass for the wrong reason.
    write("a_older.ts");
    write("z_newest.ts");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, "z_newest.ts"), future, future);

    const output = await run({ pattern: "**/*.ts" });
    const lines = output.split("\n").filter(Boolean);

    expect(lines[0]).toContain("z_newest.ts");
  });

  it("says when it stopped listing", async () => {
    write("a.ts");
    write("b.ts");
    write("c.ts");
    process.env.CONTINUE_CLI_GLOB_MAX_RESULTS = "2";

    const output = await run({ pattern: "**/*.ts" });

    expect(output.split("\n").filter((l) => l.endsWith(".ts"))).toHaveLength(2);
    expect(output.toLowerCase()).toContain("more");
  });

  it("refuses an empty pattern instead of walking the tree", async () => {
    await expect(run({ pattern: "   " })).rejects.toThrow(/pattern/);
  });

  it("names the missing program instead of pretending the tree is empty", async () => {
    ripgrep.installed = false;

    await expect(run({ pattern: "**/*.ts" })).rejects.toThrow(/ripgrep/);
  });
});
