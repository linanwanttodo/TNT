import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ignoreFile = vi.hoisted(() => ({
  current: undefined as string | undefined,
}));

vi.mock("find-up", () => ({
  findUp: async () => ignoreFile.current,
}));

import { resetRipgrepProbeCache, searchCodeTool } from "./searchCode.js";

/**
 * These cases spawn the real search program, because the claim being tested is
 * about how the arguments reach it. The payloads are written so that a shell
 * would create files inside the temporary directory, which the assertions then
 * look for - the test leaves nothing behind either way.
 */
describe("the Search tool spawns its program without a shell", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-search-spawn-"));
    fs.writeFileSync(path.join(workDir, "a.txt"), "hello world\n");
    const ignore = path.join(workDir, ".gitignore");
    fs.writeFileSync(
      ignore,
      [
        "node_modules",
        `$(touch ${path.join(workDir, "marker_sub")})`,
        `x"; touch ${path.join(workDir, "marker_quote")}; #`,
      ].join("\n"),
    );
    ignoreFile.current = ignore;
    resetRipgrepProbeCache();
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    ignoreFile.current = undefined;
    resetRipgrepProbeCache();
  });

  it("never runs what a hostile ignore file spells", async () => {
    const result = await searchCodeTool.run({
      pattern: "hello",
      path: workDir,
    });

    expect(result).toContain("hello world");
    expect(fs.existsSync(path.join(workDir, "marker_sub"))).toBe(false);
    expect(fs.existsSync(path.join(workDir, "marker_quote"))).toBe(false);
  });

  it("never runs what the pattern itself spells", async () => {
    const result = await searchCodeTool.run({
      pattern: `hello"; touch ${path.join(workDir, "marker_pattern")}; #`,
      path: workDir,
    });

    expect(result).toContain("No matches found");
    expect(fs.existsSync(path.join(workDir, "marker_pattern"))).toBe(false);
  });

  it("still excludes the names the ignore file lists", async () => {
    fs.mkdirSync(path.join(workDir, "node_modules"));
    fs.writeFileSync(
      path.join(workDir, "node_modules", "b.txt"),
      "hello from ignored\n",
    );

    const result = await searchCodeTool.run({
      pattern: "hello",
      path: workDir,
    });

    expect(result).toContain("hello world");
    expect(result).not.toContain("hello from ignored");
  });

  it("still filters by the file pattern it is given", async () => {
    fs.writeFileSync(path.join(workDir, "c.ts"), "hello in typescript\n");

    const result = await searchCodeTool.run({
      pattern: "hello",
      path: workDir,
      file_pattern: "*.ts",
    });

    expect(result).toContain("hello in typescript");
    expect(result).not.toContain("hello world");
  });
});
