import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_INSTRUCTION_CHARS,
  MAX_INCLUDE_DEPTH,
  loadInstructionFile,
} from "./instructionIncludes.js";

describe("instruction file includes", () => {
  let dir: string;

  const write = (name: string, content: string): string => {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-includes-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces an @include with the file it names", () => {
    const root = write("AGENTS.md", "Build with npm.\n\n@docs/testing.md\n");
    write("docs/testing.md", "Run the vitest gate before committing.");

    const text = loadInstructionFile(root);

    expect(text).toContain("Run the vitest gate before committing.");
    expect(text).not.toContain("@docs/testing.md");
  });

  it("follows an include written as an absolute path", () => {
    const child = write("shared.md", "Shared rule.");
    const root = write("AGENTS.md", `See @${child}`);

    expect(loadInstructionFile(root)).toContain("Shared rule.");
  });

  it("follows an include written against the home directory", () => {
    const home = process.env.HOME;
    process.env.HOME = dir;
    try {
      write("global.md", "Home rule.");
      const root = write("AGENTS.md", "See @~/global.md");

      expect(loadInstructionFile(root)).toContain("Home rule.");
    } finally {
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
    }
  });

  it("follows includes through several levels", () => {
    const root = write("a.md", "A @b.md");
    write("b.md", "B @c.md");
    write("c.md", "C");

    const text = loadInstructionFile(root);

    expect(text).toContain("A B C");
  });

  it("stops at the declared depth and says so", () => {
    const levels = MAX_INCLUDE_DEPTH + 3;
    let root = "";
    for (let level = levels; level >= 1; level--) {
      const next = level + 1;
      root = write(
        `l${level}.md`,
        next <= levels
          ? `MARKER_L${level} @l${next}.md`
          : `MARKER_L${level} ends here`,
      );
    }

    const text = loadInstructionFile(root);

    for (let level = 1; level <= MAX_INCLUDE_DEPTH; level++) {
      expect(text).toContain(`MARKER_L${level}`);
    }
    for (let level = MAX_INCLUDE_DEPTH + 1; level <= levels; level++) {
      expect(text).not.toContain(`MARKER_L${level}`);
    }
    expect(text).toContain(`includes stop at ${MAX_INCLUDE_DEPTH} levels`);
  });

  it("follows a file that appears on both sides, but not around a cycle", () => {
    const root = write("l1.md", "MARKER_ONE @l2.md and @shared.md");
    write("l2.md", "MARKER_TWO @shared.md");
    write("shared.md", "MARKER_SHARED");

    const text = loadInstructionFile(root);

    expect(text.match(/MARKER_SHARED/g)).toHaveLength(2);
    expect(text).not.toContain("circular");
  });

  it("refuses a cycle instead of doubling the file", () => {
    const root = write("l1.md", "MARKER_ONE @l2.md");
    write("l2.md", "MARKER_TWO @l1.md");

    const text = loadInstructionFile(root);

    expect(text.match(/MARKER_ONE/g)).toHaveLength(1);
    expect(text).toContain("MARKER_TWO");
    expect(text).toContain("circular");
  });

  it("refuses a file that includes itself", () => {
    const root = write("l1.md", "MARKER_ONE @l1.md");

    const text = loadInstructionFile(root);

    expect(text).toContain("circular");
    expect(text.match(/MARKER_ONE/g)).toHaveLength(1);
  });

  it("leaves a token alone when the file it names is gone", () => {
    const root = write("a.md", "See @missing.md for the rule.");

    const text = loadInstructionFile(root);

    expect(text).toContain("@missing.md");
    expect(text).toContain("@missing.md in");
    expect(text).toContain("does not exist");
  });

  it("does not treat prose or code samples as includes", () => {
    const root = write(
      "a.md",
      "Written by @author.\n\n```\n@docs/testing.md\n```\n\nCall @api.example.com sparingly.\n",
    );
    write("docs/testing.md", "MUST NOT APPEAR");

    const text = loadInstructionFile(root);

    expect(text).toContain("Written by @author.");
    expect(text).toContain("@docs/testing.md");
    expect(text).toContain("@api.example.com");
    expect(text).not.toContain("MUST NOT APPEAR");
    expect(text).not.toContain("does not exist");
  });

  it("refuses a non-text file named by an extension", () => {
    const root = write("a.md", "Diagram: @flow.pdf");
    write("flow.pdf", "%PDF-1.4 not really a diagram");

    const text = loadInstructionFile(root);

    expect(text).toContain("flow.pdf is not a text file");
    expect(text).not.toContain("PDF-1.4");
  });

  it("refuses a text-looking file that holds binary data", () => {
    const root = write("a.md", "Data: @blob.md");
    write("blob.md", "prefix\0binary");

    const text = loadInstructionFile(root);

    expect(text).toContain("blob.md is not a text file");
    expect(text).not.toContain("binary");
  });

  it("refuses a file too large to read whole", () => {
    const root = write("a.md", "Long: @huge.md");
    write("huge.md", "x".repeat(1024 * 1024 + 10));

    const text = loadInstructionFile(root);

    expect(text).toContain("so it was not read");
    expect(text).not.toContain("xxxxx");
  });

  it("cuts a file at the size limit and reports what it dropped", () => {
    const root = write(
      "a.md",
      `Keep ${"y".repeat(MAX_INSTRUCTION_CHARS)} drop ${"z".repeat(4000)}`,
    );

    const text = loadInstructionFile(root);

    expect(text).toContain("[Truncated:");
    expect(text).toContain("The limit is");
    expect(text).toContain("Keep");
    expect(text).not.toContain("zzz");
    expect(text.length).toBeLessThan(MAX_INSTRUCTION_CHARS + 300);
  });

  it("says nothing extra for a plain file", () => {
    const root = write("a.md", "Just rules.\n");

    expect(loadInstructionFile(root)).toBe("Just rules.");
  });
});
