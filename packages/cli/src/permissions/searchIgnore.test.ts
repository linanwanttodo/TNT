import { describe, expect, it, vi } from "vitest";

import { policySearchIgnorePatterns } from "./searchIgnore.js";
import type { ToolPermissions } from "./types.js";

function policies(
  ...entries: {
    tool: string;
    permission: "allow" | "ask" | "exclude";
    argumentMatches?: Record<string, unknown>;
  }[]
): ToolPermissions {
  return { policies: entries as ToolPermissions["policies"] };
}

describe("policySearchIgnorePatterns", () => {
  it("collects the path globs a file-scoped exclude names", () => {
    const patterns = policySearchIgnorePatterns(
      policies(
        {
          tool: "Read",
          permission: "exclude",
          argumentMatches: { file_path: ".env*" },
        },
        {
          tool: "Edit",
          permission: "exclude",
          argumentMatches: { filepath: "secrets/**" },
        },
      ),
    );

    expect(patterns).toEqual([".env*", "secrets/**"]);
  });

  it("ignores allows, asks, command rules and tool-level rules", () => {
    const patterns = policySearchIgnorePatterns(
      policies(
        { tool: "Read", permission: "allow" },
        {
          tool: "Bash",
          permission: "exclude",
          argumentMatches: { command: "rm*" },
        },
        { tool: "*", permission: "exclude" },
        { tool: "Write", permission: "exclude" },
      ),
    );

    expect(patterns).toEqual([]);
  });

  it("strips a leading ./ and deduplicates", () => {
    const patterns = policySearchIgnorePatterns(
      policies(
        {
          tool: "Read",
          permission: "exclude",
          argumentMatches: { file_path: "./.secrets/*" },
        },
        {
          tool: "Edit",
          permission: "exclude",
          argumentMatches: { filepath: ".secrets/*" },
        },
      ),
    );

    expect(patterns).toEqual([".secrets/*"]);
  });
});

describe("the search tools consume the policy refusals", () => {
  it("hands the policy globs to ripgrep in Search and Glob (T5.3)", async () => {
    vi.doMock("../services/index.js", () => ({
      services: {
        toolPermissions: {
          getState: () => ({
            permissions: {
              policies: [
                {
                  tool: "Read",
                  permission: "exclude",
                  argumentMatches: { file_path: ".secrets/*" },
                },
              ],
            },
          }),
        },
      },
    }));

    try {
      const execFileMock = vi.fn(
        (
          _file: string,
          args: string[],
          _options: unknown,
          callback: (err: unknown, out: { stdout: string }) => void,
        ) => callback(null, { stdout: "" }),
      );
      vi.doMock("child_process", () => ({
        execFile: (
          file: string,
          args: string[],
          options: unknown,
          callback: (err: unknown, out: { stdout: string }) => void,
        ) => execFileMock(file, args, options, callback),
      }));
      vi.doMock("find-up", () => ({ findUp: async () => undefined }));

      const { searchCodeTool } = await import("../tools/searchCode.js");
      await searchCodeTool.run!({ pattern: "password" } as any);
      const searchArgs = execFileMock.mock.calls.at(-1)![1] as string[];
      expect(
        searchArgs.some(
          (arg, index) =>
            arg === "--glob" && searchArgs[index + 1] === "!.secrets/*",
        ),
      ).toBe(true);

      const { globFilesTool } = await import("../tools/globFiles.js");
      await globFilesTool.run!({ pattern: "*.ts" } as any);
      const globArgs = execFileMock.mock.calls.at(-1)![1] as string[];
      expect(
        globArgs.some(
          (arg, index) =>
            arg === "--glob" && globArgs[index + 1] === "!.secrets/*",
        ),
      ).toBe(true);
    } finally {
      vi.doUnmock("../services/index.js");
      vi.doUnmock("child_process");
      vi.doUnmock("find-up");
      vi.resetModules();
    }
  });
});
