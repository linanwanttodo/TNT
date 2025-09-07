import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as diff from "diff";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("fs", async () => {
  // Use actual fs implementation for non-mocked functions, and let the two
  // mocked ones fall through to it by default: a stub that answers "undefined"
  // for every path made these tests fail for the wrong reason (the tools check
  // what exists), which is why the block below used to be skipped.
  const actualFs = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...(actualFs as any),
    default: actualFs,
    existsSync: vi.fn((...args: any[]) =>
      (actualFs as any).existsSync(...args),
    ),
    readFileSync: vi.fn((...args: any[]) =>
      (actualFs as any).readFileSync(...args),
    ),
  };
});

// Mock telemetry service - the path has to be relative to this file, which is
// why the block below used to be skipped rather than passing.
vi.mock("../telemetry/telemetryService.js");
// Mock diff module
vi.mock("diff", () => ({
  createTwoFilesPatch: vi.fn(),
}));

// Get mocked functions using vi.mocked
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockCreateTwoFilesPatch = vi.mocked(diff.createTwoFilesPatch);

import { fetchTool } from "./fetch.js";
import { formatToolArgument } from "./formatters.js";
import { listFilesTool } from "./listFiles.js";
import { readFileTool } from "./readFile.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { searchCodeTool } from "./searchCode.js";
import { viewDiffTool } from "./viewDiff.js";
import { writeFileTool } from "./writeFile.js";

describe("Tool preprocess functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The mock functions will be configured in each test as needed
  });

  describe("fetchTool.preprocess", () => {
    it("should return preview with URL to fetch", async () => {
      const args = { url: "https://example.com" };
      const result = await fetchTool.preprocess!(args);

      expect(result).toEqual({
        preview: [
          {
            type: "text",
            content: "Will fetch: https://example.com",
          },
        ],
        args,
      });
    });

    it("should handle URL with timeout parameter", async () => {
      const args = { url: "https://example.com", timeout: 5000 };
      const result = await fetchTool.preprocess!(args);

      expect(result).toEqual({
        preview: [
          {
            type: "text",
            content: "Will fetch: https://example.com",
          },
        ],
        args,
      });
    });
  });

  describe("listFilesTool.preprocess", () => {
    it("names the resolved directory in the preview", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-list-"));
      try {
        const result = await listFilesTool.preprocess!({ dirpath: dir });

        // The path is resolved before the preview is built, so what the user
        // reads is the directory the tool will actually list.
        expect(result.args.dirpath).toBe(dir);
        expect(result.preview).toEqual([
          {
            type: "text",
            content: `Will list files in: ${formatToolArgument(dir)}`,
          },
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("lists the working directory when the call names none", async () => {
      const result = await listFilesTool.preprocess!({});

      expect(result.args.dirpath).toBe(process.cwd());
      expect(result.preview).toEqual([
        { type: "text", content: `Will list files in: ${process.cwd()}` },
      ]);
    });

    it("refuses a path that is not there, with the tool's own reason", async () => {
      await expect(
        listFilesTool.preprocess!({ dirpath: "/no/such/directory" }),
      ).rejects.toThrow(/Directory does not exist: \/no\/such\/directory/);
    });
  });

  describe("readFileTool.preprocess", () => {
    it("should return formatted tool call preview", async () => {
      const args = { filepath: "path/to/file.txt" };
      const result = await readFileTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "Will read path/to/file.txt",
          },
        ],
      });
    });
  });

  describe("runTerminalCommandTool.preprocess", () => {
    it("should return preview with full command when short", async () => {
      const args = { command: "ls -la" };
      const result = await runTerminalCommandTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "Will run: ls -la",
          },
        ],
      });
    });

    it("should truncate long commands", async () => {
      const longCommand = "a".repeat(100);
      const args = { command: longCommand };
      const result = await runTerminalCommandTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: `Will run: ${"a".repeat(60)}...`,
          },
        ],
      });
    });
  });

  describe("searchCodeTool.preprocess", () => {
    it("should return preview with full pattern when short", async () => {
      const args = { pattern: "searchTerm" };
      const result = await searchCodeTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: 'Will search for: "searchTerm"',
          },
        ],
      });
    });

    it("should truncate long patterns", async () => {
      const longPattern = "a".repeat(100);
      const args = { pattern: longPattern };
      const result = await searchCodeTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: `Will search for: "${"a".repeat(50)}..."`,
          },
        ],
      });
    });
  });

  describe("viewDiffTool.preprocess", () => {
    it("should return preview indicating git diff will be shown", async () => {
      const args = { path: "/repo/path" };
      const result = await viewDiffTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "Will show git diff",
          },
        ],
      });
    });

    it("should handle empty args", async () => {
      const args = {};
      const result = await viewDiffTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "Will show git diff",
          },
        ],
      });
    });
  });

  describe("writeFileTool.preprocess", () => {
    it("should show diff preview when file exists", async () => {
      // Setup mocks for this test
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("old content");
      mockCreateTwoFilesPatch.mockReturnValue("mock diff content");

      const args = { filepath: "path/to/file.txt", content: "new content" };
      const result = await writeFileTool.preprocess!(args);

      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockReadFileSync).toHaveBeenCalled();
      expect(mockCreateTwoFilesPatch).toHaveBeenCalled();

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "Preview of changes:",
          },
          {
            type: "diff",
            content: "mock diff content",
          },
        ],
      });
    });

    it("should show new file content preview when file doesn't exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const args = {
        filepath: "path/to/file.txt",
        content: "line 1\nline 2\nline 3\nline 4",
      };
      const result = await writeFileTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "New file content:",
          },
          {
            type: "text",
            content: "line 1",
            paddingLeft: 2,
          },
          {
            type: "text",
            content: "line 2",
            paddingLeft: 2,
          },
          {
            type: "text",
            content: "line 3",
            paddingLeft: 2,
          },
          {
            type: "text",
            content: "... (1 more lines)",
          },
        ],
      });
    });

    it("should handle empty lines in new file preview", async () => {
      mockExistsSync.mockReturnValue(false);

      const args = {
        filepath: "path/to/file.txt",
        content: "line 1\n\nline 3",
      };
      const result = await writeFileTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "New file content:",
          },
          {
            type: "text",
            content: "line 1",
            paddingLeft: 2,
          },
          {
            type: "text",
            content: " ",
            paddingLeft: 2,
          },
          {
            type: "text",
            content: "line 3",
            paddingLeft: 2,
          },
        ],
      });
    });

    it("should handle fs errors gracefully", async () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const args = { filepath: "path/to/file.txt", content: "new content" };
      const result = await writeFileTool.preprocess!(args);

      expect(result).toEqual({
        args,
        preview: [
          {
            type: "text",
            content: "New file content:",
          },
          {
            type: "text",
            content: "new content",
            paddingLeft: 2,
          },
        ],
      });
    });
  });
});
