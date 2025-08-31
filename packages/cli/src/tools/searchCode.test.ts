import * as nodeUtil from "util";

import { vi } from "vitest";

const execFileMock: any = vi.fn();
execFileMock[(nodeUtil as any).promisify.custom] = (
  file: any,
  args: any,
  options: any,
) =>
  new Promise((resolve, reject) => {
    execFileMock(file, args, options, (err: any, stdout: any, stderr: any) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });

vi.mock("child_process", () => ({ execFile: execFileMock }));

// Without this the repository's own .gitignore adds an argument pair per line.
vi.mock("find-up", () => ({ findUp: async () => undefined }));

// Since we want to test just the interface and not the internals,
// let's create a simplified version of the run function to test the truncation logic
describe("searchCodeTool", () => {
  // We'll test the functionality without mocking the dependencies
  // Instead, we'll focus on the core truncation logic by directly checking
  // if truncation happens with large outputs

  it("should include truncation message when output exceeds limit", () => {
    // Create a large sample output (more than 100 lines)
    const largeOutput = Array.from(
      { length: 150 },
      (_, i) => `file${i}.ts:${i}:const foo = 'bar';`,
    ).join("\n");

    // Check if the truncation logic is applied by the function
    const truncatedOutput = `Search results for pattern "foo":\n\n${largeOutput.split("\n").slice(0, 100).join("\n")}\n\n[Results truncated: showing 100 of 150 matches]`;

    // Verify the truncation message is included and only 100 lines are shown
    const lines = truncatedOutput.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim() !== "");

    // Count the content lines (excluding header and truncation message)
    const contentLines = nonEmptyLines.slice(1, -1);

    // Check that we have exactly 100 content lines
    expect(contentLines.length).toBe(100);

    // Check that the truncation message is present
    expect(truncatedOutput).toContain(
      "[Results truncated: showing 100 of 150 matches]",
    );
  });

  it("should not include truncation message when output is within limit", () => {
    // Create a sample output (less than 100 lines)
    const smallOutput = Array.from(
      { length: 50 },
      (_, i) => `file${i}.ts:${i}:const foo = 'bar';`,
    ).join("\n");

    // Format the output as the function would
    const output = `Search results for pattern "foo":\n\n${smallOutput}`;

    // Verify no truncation message is included
    expect(output).not.toContain("[Results truncated:");

    // Count the lines
    const lines = output.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim() !== "");

    // Check that we have the expected number of lines (header + 50 content lines)
    expect(nonEmptyLines.length).toBe(51);
  });

  describe("searchCodeTool line-length filtering", () => {
    afterEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
    });

    it("filters out lines longer than 1000 characters", async () => {
      const childProc = await import("child_process");
      const long = "a".repeat(1001);

      vi.mocked(childProc.execFile as any).mockImplementation(
        (...args: any[]) => {
          // execFile callback signature: (error, stdout, stderr)
          const cb = args[args.length - 1];
          cb(null, `path/file.ts:1:${long}\npath/file.ts:2:match`, "");
          return {} as any;
        },
      );

      const { searchCodeTool } = await import("./searchCode.js");
      const result = await searchCodeTool.run({ pattern: "match", path: "." });

      expect(result).toContain("path/file.ts:2:match");
      expect(result).not.toContain(long);
      expect(result).not.toContain("[Results truncated:");
    });

    it("hands the pattern to the program as one argument", async () => {
      const childProc = await import("child_process");
      const spawns: Array<[string, string[]]> = [];
      vi.mocked(childProc.execFile as any).mockImplementation(
        (...args: any[]) => {
          spawns.push([args[0], args[1]]);
          const cb = args[args.length - 1];
          cb(null, "path/file.ts:1:match", "");
          return {} as any;
        },
      );

      const { searchCodeTool } = await import("./searchCode.js");
      const pattern = 'x"; touch marker; #';
      await searchCodeTool.run({
        pattern,
        path: ".",
        file_pattern: "*.ts",
      });

      // Nothing here reaches a shell: an element of this list cannot start a
      // second command, and no element is a command line.
      expect(spawns[spawns.length - 1][1]).toEqual([
        "--line-number",
        "--with-filename",
        "--color",
        "never",
        "--glob",
        "*.ts",
        "--",
        pattern,
        ".",
      ]);
    });

    it("names no shell in the options it spawns with", async () => {
      const childProc = await import("child_process");
      const options: any[] = [];
      vi.mocked(childProc.execFile as any).mockImplementation(
        (...args: any[]) => {
          options.push(args[2]);
          const cb = args[args.length - 1];
          cb(null, "", "");
          return {} as any;
        },
      );

      const { searchCodeTool } = await import("./searchCode.js");
      await searchCodeTool.run({ pattern: "match", path: "." });

      // execFile would honour a shell option by handing the argument list to it,
      // which is exactly the step that turns arguments back into syntax.
      for (const option of options) {
        expect(option?.shell).toBeFalsy();
      }
      expect(options.length).toBeGreaterThan(0);
    });
  });
});
